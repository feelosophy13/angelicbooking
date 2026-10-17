/**
 * Online store on the booking site: gift cards (delivered by email) and
 * retail products for pickup or flat-rate shipping. An order is a normal sale
 * (source "online") paid with a PaymentIntent on the business's Stripe
 * account; closing it issues the gift card and emails the buyer.
 *
 * The card is authorized first and captured only once the stock is checked again
 * (capture_method "manual"): a buyer who pays after their cart hold ran out, while
 * the last one was sold, is never charged; the authorization is released and the
 * order voided instead. A page closed after authorizing is settled by
 * sweepAuthorizedOrders (the 5-minute jobs run) with the same decision.
 */
import type Stripe from "stripe";
import { after } from "next/server";
import { browserStripe } from "@/lib/stripe-demo";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { stripe, appUrl, isStripeConfigured } from "@/lib/stripe";
import { platformFeeBpsFor } from "./price-book";
import { paymentContextFor, paymentContextForSale } from "./locations";
import { ensureStripeCustomer } from "./stripe-connect";
import { findOrCreateClient, type PublicBusiness } from "./public-booking";
import { markCardPaymentSucceeded } from "./sales";
import { onlineAvailability } from "./inventory";
import { productLabel } from "@/lib/inventory";
import { queueOneOff } from "@/lib/notify";
import { giftCardEmail, orderEmail } from "@/lib/notify/templates";
import { formatMoney } from "@/lib/utils";

export class StoreError extends Error {}

export const GIFT_PRESETS_CENTS = [2500, 5000, 7500, 10000, 15000, 20000];

/** Online orders are taken at the chosen location (its Stripe account and tax rate), else the default one. */
export async function storeReady(business: PublicBusiness, locationId?: string | null): Promise<boolean> {
  const pay = await paymentContextFor(business, locationId);
  return pay.ready && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

/** What the shop lists, with how many can still be sold at the location (null: stock isn't tracked). */
export async function storeProducts(businessId: string, locationId?: string | null) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ p: schema.products, category: schema.productCategories.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .where(and(eq(schema.products.active, true), eq(schema.products.sellOnline, true), eq(schema.products.kind, "retail"), gt(schema.products.priceCents, 0)))
      .orderBy(asc(schema.productCategories.sortOrder), asc(schema.products.name), asc(schema.products.variantLabel));
    const avail = await onlineAvailability(tx, locationId ?? null, rows.map((r) => r.p.id));
    return rows.map((r) => ({ ...r, available: avail.get(r.p.id) ?? null }));
  });
}

export interface OrderInput {
  items: { productId: string; quantity: number }[];
  giftCard: { amountCents: number; recipientName: string | null; recipientEmail: string | null; message: string | null } | null;
  buyer: { firstName: string; lastName: string; email: string; phone: string | null };
  fulfillment: { method: "pickup" | "ship"; address: string | null };
}

/** Create the open sale and the PaymentIntent the browser confirms. */
export async function startOrder(business: PublicBusiness, input: OrderInput, locationId?: string | null) {
  if (!(await storeReady(business, locationId))) throw new StoreError("Online payments aren't set up yet.");
  const pay = await paymentContextFor(business, locationId);
  if (!input.items.length && !input.giftCard) throw new StoreError("Your cart is empty.");
  if (input.items.length && !business.storeEnabled) throw new StoreError("The store isn't open right now.");
  if (input.giftCard && !business.giftCardsOnline) throw new StoreError("Gift cards can't be bought online right now.");
  if (input.giftCard && (input.giftCard.amountCents < 500 || input.giftCard.amountCents > 100000)) throw new StoreError("Gift cards are between $5 and $1,000.");
  if (input.fulfillment.method === "ship" && (!business.shippingFlatCents || !input.fulfillment.address)) throw new StoreError("Enter a shipping address.");
  const clientId = await findOrCreateClient(business.id, { ...input.buyer, phone: input.buyer.phone, notes: null, serviceId: "", staffId: "", startAt: new Date(), email: input.buyer.email });
  const accountId = pay.accountId!;
  const { sale, pending, total, client, fee } = await withTenant(business.id, async (tx) => {
    const products = input.items.length ? await tx.select().from(schema.products).where(and(eq(schema.products.active, true), eq(schema.products.sellOnline, true), eq(schema.products.kind, "retail"), sql`${schema.products.id} in ${input.items.map((i) => i.productId)}`)) : [];
    // What can still be sold here: on hand at this location, less other buyers' unpaid orders (the products are locked while we check).
    const available = await onlineAvailability(tx, pay.location?.id ?? null, products.map((p) => p.id), { lock: true });
    const lines: (typeof schema.saleLines.$inferInsert)[] = [];
    let subtotal = 0;
    let taxable = 0;
    // The same product on two lines counts once against what is left: merge them first.
    const merged = new Map<string, number>();
    for (const it of input.items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + Math.max(1, Math.floor(it.quantity)));
    for (const it of [...merged].map(([productId, quantity]) => ({ productId, quantity }))) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) throw new StoreError("One of the products is no longer available.");
      const qty = Math.floor(it.quantity);
      if (qty > 20) throw new StoreError(`Up to 20 of ${productLabel(p)} per order.`);
      const left = available.get(p.id);
      if (left != null && left < qty) throw new StoreError(left <= 0 ? `${productLabel(p)} just sold out.` : `Only ${left} of ${productLabel(p)} left.`);
      const amount = p.priceCents * qty;
      subtotal += amount;
      if (p.taxable) taxable += amount;
      lines.push({ businessId: business.id, kind: "product", productId: p.id, name: productLabel(p), quantity: qty, unitCents: p.priceCents, amountCents: amount, taxable: p.taxable, sortOrder: lines.length, saleId: "" });
    }
    if (input.giftCard) {
      const g = input.giftCard;
      subtotal += g.amountCents;
      lines.push({ businessId: business.id, kind: "gift_card", name: `Gift card${g.recipientName ? ` for ${g.recipientName}` : ""}`, quantity: 1, unitCents: g.amountCents, amountCents: g.amountCents, taxable: false, sortOrder: 100, saleId: "" });
    }
    const shipping = input.fulfillment.method === "ship" ? business.shippingFlatCents : 0;
    if (shipping) {
      subtotal += shipping;
      lines.push({ businessId: business.id, kind: "fee", name: "Shipping", quantity: 1, unitCents: shipping, amountCents: shipping, taxable: false, sortOrder: 200, saleId: "" });
    }
    const tax = Math.round((taxable * pay.taxRateBps) / 10_000);
    const total = subtotal + tax;
    if (total < 50) throw new StoreError("Order total must be at least $0.50.");
    const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${business.id}) as n`);
    const [sale] = await tx
      .insert(schema.sales)
      .values({
        businessId: business.id,
        number: Number(rows[0]?.n ?? 1001),
        clientId,
        locationId: pay.location?.id ?? null,
        currency: business.currency,
        source: "online",
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        fulfillment: { method: input.fulfillment.method, name: `${input.buyer.firstName} ${input.buyer.lastName}`.trim(), email: input.buyer.email, phone: input.buyer.phone ?? undefined, address: input.fulfillment.address ?? undefined, message: input.giftCard?.message ?? undefined, status: "pending" },
      })
      .returning();
    await tx.insert(schema.saleLines).values(lines.map((l) => ({ ...l, saleId: sale!.id })));
    if (input.giftCard?.recipientEmail) {
      // Remember where to send the card; read back when the sale closes.
      await tx.update(schema.sales).set({ discountNote: null, fulfillment: { ...sale!.fulfillment!, giftRecipientEmail: input.giftCard.recipientEmail, giftRecipientName: input.giftCard.recipientName ?? undefined } as never }).where(eq(schema.sales.id, sale!.id));
    }
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    const [pending] = await tx.insert(schema.payments).values({ businessId: business.id, saleId: sale!.id, method: "card", status: "pending", amountCents: total, tipCents: 0, stripeAccountId: accountId }).returning();
    const fee = Math.round((total * (await platformFeeBpsFor(business.id, tx))) / 10_000);
    return { sale: sale!, pending: pending!, total, client, fee };
  });
  // Stripe is called with no transaction open (the order and its pending payment are already saved).
  try {
    const customer = client ? await ensureStripeCustomer({ accountId, businessId: business.id, client }) : undefined;
    const pi = await stripe().paymentIntents.create(
      // Authorize only: the card is captured in finishOrder (or the sweep) once the stock is checked again.
      { amount: total, currency: business.currency, customer, capture_method: "manual", allowed_payment_method_types: ["card"], description: `Order #${sale.number} · ${pay.name}`, receipt_email: input.buyer.email, metadata: { businessId: business.id, saleId: sale.id, paymentId: pending.id, kind: "order" }, ...(fee > 0 ? { application_fee_amount: fee } : {}) },
      { stripeAccount: accountId, idempotencyKey: `order_${pending.id}` },
    );
    await withTenant(business.id, (tx) => tx.update(schema.payments).set({ stripePaymentIntentId: pi.id }).where(eq(schema.payments.id, pending.id)));
    const browser = await browserStripe(accountId, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    return { saleId: sale.id, clientSecret: pi.client_secret!, accountId: browser.stripeAccount, publishableKey: browser.publishableKey, totalCents: total };
  } catch (e) {
    // Nothing was charged: drop the payment and void the order so it stops holding stock.
    await withTenant(business.id, async (tx) => {
      await tx.delete(schema.payments).where(and(eq(schema.payments.id, pending.id), eq(schema.payments.status, "pending"), sql`${schema.payments.stripePaymentIntentId} is null`));
      await tx.update(schema.sales).set({ status: "void", closedAt: new Date() }).where(and(eq(schema.sales.id, sale.id), eq(schema.sales.status, "open")));
    });
    throw e;
  }
}

/**
 * The browser confirmed (authorized) the PaymentIntent: verify it with Stripe, capture it if the stock is still there and close the sale,
 * email the buyer (and gift recipient). Sold out meanwhile: the authorization is released, the order voided, and the buyer told why.
 */
export async function finishOrder(business: PublicBusiness, saleId: string, paymentIntentId: string) {
  const accountId = (await paymentContextForSale(business, saleId)).accountId;
  if (!accountId) throw new StoreError("Payments aren't set up.");
  const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
  if (pi.metadata.saleId !== saleId || pi.metadata.businessId !== business.id) throw new StoreError("That payment doesn't match this order.");
  const out = await settleOrderPayment(business, saleId, pi, accountId);
  if (out.status === "released") throw new StoreError(out.message);
  after(() => sendOrderEmailsOnce(business.id, saleId).catch((e) => console.error("[store] order emails failed", saleId, (e as Error).message)));
  return getOrder(business.id, saleId);
}

export type OrderSettlement = { status: "paid" } | { status: "released"; message: string };

const NOT_CHARGED = "Your card wasn't charged.";
const CANCELED = `The payment was canceled, so the order didn't go through. ${NOT_CHARGED}`;

/**
 * Settle an order's PaymentIntent.
 * - Authorized (requires_capture): every product line is checked against what is left at the order's location (products locked, this
 *   order's own hold left out). All there: capture, then close the sale. Something short: cancel (the authorization is released, nothing
 *   is charged) and void the order.
 * - Already captured: close the sale. Canceled: void the order. Anything else (not paid yet): an error.
 * Stripe is called with no transaction open. Safe for the browser and the sweep to run at once on the same order: capture and cancel are
 * idempotent per PaymentIntent, and when the other one got there first we follow what Stripe says happened.
 */
export async function settleOrderPayment(business: PublicBusiness, saleId: string, pi: Stripe.PaymentIntent, accountId: string): Promise<OrderSettlement> {
  if (pi.status === "succeeded") return closePaidOrder(business, pi);
  if (pi.status === "canceled") return voidOrder(business.id, saleId, pi.id, CANCELED);
  if (pi.status !== "requires_capture") throw new StoreError(`Payment ${pi.status.replace(/_/g, " ")}.`);
  const shortfall = await withTenant(business.id, async (tx) => {
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, saleId)).for("update");
    if (!sale) throw new StoreError("Order not found.");
    if (sale.status === "void") return `This order was canceled. ${NOT_CHARGED}`;
    if (sale.status !== "open") return null;
    const lines = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), eq(schema.saleLines.kind, "product"), isNotNull(schema.saleLines.productId)));
    const wanted = new Map<string, { qty: number; name: string }>();
    for (const l of lines) wanted.set(l.productId!, { qty: (wanted.get(l.productId!)?.qty ?? 0) + l.quantity, name: l.name });
    // Locked: a concurrent order (or a second settle of this one) queues behind this check.
    const available = await onlineAvailability(tx, sale.locationId, [...wanted.keys()], { lock: true, excludeSaleId: saleId });
    for (const [productId, w] of wanted) {
      const left = available.get(productId);
      if (left != null && left < w.qty) return left <= 0 ? `${w.name} just sold out, so the order didn't go through. ${NOT_CHARGED}` : `Only ${left} of ${w.name} left, so the order didn't go through. ${NOT_CHARGED}`;
    }
    return null;
  });
  const opts = (op: "capture" | "cancel") => ({ stripeAccount: accountId, idempotencyKey: `order_${op}_${pi.id}` });
  if (!shortfall) {
    const done = await stripe().paymentIntents.capture(pi.id, { expand: ["latest_charge"] }, opts("capture")).catch((e) => settledInStripe(pi.id, accountId, e));
    if (done.status === "canceled") return voidOrder(business.id, saleId, pi.id, CANCELED);
    if (done.status !== "succeeded") throw new StoreError(`Payment ${done.status.replace(/_/g, " ")}.`);
    return closePaidOrder(business, done);
  }
  const done = await stripe().paymentIntents.cancel(pi.id, {}, opts("cancel")).catch((e) => settledInStripe(pi.id, accountId, e));
  // Captured first by the other settle: the money was taken, so the sale is recorded rather than lost.
  if (done.status === "succeeded") return closePaidOrder(business, done);
  return voidOrder(business.id, saleId, pi.id, shortfall);
}

/** After a capture or cancel failed: the PaymentIntent if it is already captured or canceled (someone else settled it), else the error. */
async function settledInStripe(paymentIntentId: string, accountId: string, e: unknown): Promise<Stripe.PaymentIntent> {
  const fresh = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
  if (fresh.status === "succeeded" || fresh.status === "canceled") return fresh;
  throw e;
}

async function closePaidOrder(business: PublicBusiness, pi: Stripe.PaymentIntent): Promise<OrderSettlement> {
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  await markCardPaymentSucceeded({
    businessId: business.id,
    paymentIntentId: pi.id,
    chargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
    card: { brand: charge?.payment_method_details?.card?.brand ?? null, last4: charge?.payment_method_details?.card?.last4 ?? null },
    taxRateBps: business.taxRateBps,
    metadata: pi.metadata,
  });
  return { status: "paid" };
}

/** The card was never charged (authorization released, or canceled): fail the pending payment and void the order so it stops holding stock. */
async function voidOrder(businessId: string, saleId: string, paymentIntentId: string, message: string): Promise<OrderSettlement> {
  await withTenant(businessId, async (tx) => {
    await tx.update(schema.payments).set({ status: "failed", note: message }).where(and(eq(schema.payments.saleId, saleId), eq(schema.payments.stripePaymentIntentId, paymentIntentId), inArray(schema.payments.status, ["pending", "failed"])));
    const voided = await tx.update(schema.sales).set({ status: "void", closedAt: new Date() }).where(and(eq(schema.sales.id, saleId), eq(schema.sales.status, "open"))).returning({ id: schema.sales.id });
    if (voided.length) await tx.insert(schema.auditLog).values({ businessId, actorUserId: null, action: "order.released", entity: "sale", entityId: saleId, diff: JSON.stringify({ paymentIntentId, why: message }) });
  });
  return { status: "released", message };
}

/** An order authorized and still open this long after checkout started: the buyer's page didn't come back, so the sweep settles it. */
export const ORDER_SETTLE_AFTER_MINUTES = 15;
/** An order never paid this long after checkout started is abandoned: its PaymentIntent is canceled and the order voided. */
export const ORDER_ABANDONED_AFTER_HOURS = 24;

/**
 * Settle online orders whose buyer authorized the card but never came back (capture if the stock is still there, else release the
 * authorization), and close out abandoned ones so they aren't looked at again. Businesses with the store or online gift cards on, up to 50
 * orders each per run. Called by the 5-minute jobs run.
 */
export async function sweepAuthorizedOrders(opts: { businessIds?: string[] } = {}): Promise<{ checked: number; captured: number; released: number; abandoned: number; failed: number }> {
  const out = { checked: 0, captured: 0, released: 0, abandoned: 0, failed: 0 };
  if (!isStripeConfigured()) return out;
  const businesses = await db
    .select()
    .from(schema.businesses)
    .where(and(or(eq(schema.businesses.storeEnabled, true), eq(schema.businesses.giftCardsOnline, true)), opts.businessIds ? inArray(schema.businesses.id, opts.businessIds) : sql`true`));
  const settleBefore = new Date(Date.now() - ORDER_SETTLE_AFTER_MINUTES * 60_000);
  const abandonedBefore = new Date(Date.now() - ORDER_ABANDONED_AFTER_HOURS * 3_600_000);
  // An authorization lasts about 7 days; older orders are left alone.
  const since = new Date(Date.now() - 8 * 86_400_000);
  for (const business of businesses) {
    const rows = await withTenant(business.id, (tx) =>
      tx
        .select({ saleId: schema.sales.id, createdAt: schema.sales.createdAt, paymentIntentId: schema.payments.stripePaymentIntentId, accountId: schema.payments.stripeAccountId })
        .from(schema.sales)
        .innerJoin(schema.payments, eq(schema.payments.saleId, schema.sales.id))
        .where(and(eq(schema.sales.source, "online"), eq(schema.sales.status, "open"), eq(schema.payments.method, "card"), inArray(schema.payments.status, ["pending", "failed"]), isNotNull(schema.payments.stripePaymentIntentId), isNotNull(schema.payments.stripeAccountId), lt(schema.sales.createdAt, settleBefore), gte(schema.sales.createdAt, since)))
        .orderBy(asc(schema.sales.createdAt))
        .limit(50),
    );
    for (const r of rows) {
      out.checked++;
      const accountId = r.accountId!;
      try {
        let pi = await stripe().paymentIntents.retrieve(r.paymentIntentId!, { expand: ["latest_charge"] }, { stripeAccount: accountId });
        if (pi.metadata?.saleId !== r.saleId || pi.metadata?.businessId !== business.id) continue;
        if (!["requires_capture", "succeeded", "canceled"].includes(pi.status)) {
          if (r.createdAt >= abandonedBefore) continue; // The buyer may still be paying.
          // Never paid: cancel it so it can't be paid later without a stock check. (Paid at the last moment: settled below like any other.)
          pi = await stripe()
            .paymentIntents.cancel(pi.id, {}, { stripeAccount: accountId, idempotencyKey: `order_cancel_${pi.id}` })
            .catch(async (e) => {
              const fresh = await stripe().paymentIntents.retrieve(pi.id, { expand: ["latest_charge"] }, { stripeAccount: accountId });
              if (["requires_capture", "succeeded", "canceled"].includes(fresh.status)) return fresh;
              throw e;
            });
          if (pi.status === "canceled") {
            await voidOrder(business.id, r.saleId, pi.id, `Checkout was never finished. ${NOT_CHARGED}`);
            out.abandoned++;
            continue;
          }
        }
        const s = await settleOrderPayment(business, r.saleId, pi, accountId);
        if (s.status === "released") {
          out.released++;
          continue;
        }
        out.captured++;
        await sendOrderEmailsOnce(business.id, r.saleId).catch((e) => console.error("[store] order emails failed", r.saleId, (e as Error).message));
      } catch (e) {
        out.failed++;
        console.error("[store] settling order failed", r.saleId, (e as Error).message);
      }
    }
  }
  return out;
}

/** Unguessable key that lets the buyer (and only the buyer) open the order page; it is never emailed or stored. */
export function orderKey(businessId: string, saleId: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`order:${businessId}:${saleId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderKey(businessId: string, saleId: string, key: string | undefined): boolean {
  if (!key) return false;
  const expected = orderKey(businessId, saleId);
  return expected.length === key.length && timingSafeEqual(Buffer.from(expected), Buffer.from(key));
}

export async function getOrder(businessId: string, saleId: string) {
  return withTenant(businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
    if (!sale) return null;
    const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId)).orderBy(asc(schema.saleLines.sortOrder));
    const cards = await tx.select().from(schema.giftCards).where(eq(schema.giftCards.saleId, saleId));
    return { sale, lines, giftCards: cards };
  });
}

/**
 * Email the receipt (and any gift card) for a paid online order, once. Both the buyer's return to the page and the Stripe webhook call this,
 * so it still happens when the buyer closed the page before it came back; the first caller to stamp the order sends.
 */
export async function sendOrderEmailsOnce(businessId: string, saleId: string) {
  const claimed = await withTenant(businessId, (tx) =>
    tx
      .update(schema.sales)
      .set({ fulfillment: sql`coalesce(${schema.sales.fulfillment}, '{}'::jsonb) || jsonb_build_object('emailsSentAt', now())` })
      .where(and(eq(schema.sales.id, saleId), eq(schema.sales.status, "paid"), sql`not (coalesce(${schema.sales.fulfillment}, '{}'::jsonb) ? 'emailsSentAt')`))
      .returning({ id: schema.sales.id }),
  );
  if (!claimed.length) return;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
  if (business) await sendOrderEmails(business, saleId);
}

async function sendOrderEmails(business: PublicBusiness, saleId: string) {
  const o = await getOrder(business.id, saleId);
  if (!o || o.sale.status !== "paid") return;
  const f = (o.sale.fulfillment ?? {}) as { method?: "pickup" | "ship"; name?: string; email?: string; address?: string; message?: string; giftRecipientEmail?: string; giftRecipientName?: string };
  const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine };
  const money = (c: number) => formatMoney(c, business.currency);
  if (f.email) {
    const t = orderEmail(brand, { number: o.sale.number, lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, amount: money(l.amountCents) })), total: money(o.sale.totalCents), method: f.method ?? "pickup", address: f.address ?? null });
    await queueOneOff(business.id, { channel: "email", template: "order", recipient: f.email, subject: t.subject, body: t.html, clientId: o.sale.clientId });
  }
  for (const g of o.giftCards) {
    const to = f.giftRecipientEmail ?? f.email;
    if (!to) continue;
    const t = giftCardEmail(brand, { code: g.code, amount: money(g.initialCents), from: f.name ?? null, message: f.message ?? null, bookingUrl: appUrl(`/book/${business.slug}`) });
    await queueOneOff(business.id, { channel: "email", template: "gift_card", recipient: to, subject: t.subject, body: t.html, clientId: o.sale.clientId });
  }
}

// keep normalizePhone referenced for callers that pre-validate
void normalizePhone;
