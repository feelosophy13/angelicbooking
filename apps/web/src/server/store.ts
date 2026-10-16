/**
 * Online store on the booking site: gift cards (delivered by email) and
 * retail products for pickup or flat-rate shipping. An order is a normal sale
 * (source "online") paid with a PaymentIntent on the business's Stripe
 * account; closing it issues the gift card and emails the buyer.
 */
import { after } from "next/server";
import { browserStripe } from "@/lib/stripe-demo";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { stripe, appUrl } from "@/lib/stripe";
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
      { amount: total, currency: business.currency, customer, allowed_payment_method_types: ["card"], description: `Order #${sale.number} · ${pay.name}`, receipt_email: input.buyer.email, metadata: { businessId: business.id, saleId: sale.id, paymentId: pending.id, kind: "order" }, ...(fee > 0 ? { application_fee_amount: fee } : {}) },
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

/** The browser confirmed the PaymentIntent: verify with Stripe, close the sale, email the buyer (and gift recipient). */
export async function finishOrder(business: PublicBusiness, saleId: string, paymentIntentId: string) {
  const accountId = (await paymentContextForSale(business, saleId)).accountId;
  if (!accountId) throw new StoreError("Payments aren't set up.");
  const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
  if (pi.metadata.saleId !== saleId || pi.metadata.businessId !== business.id) throw new StoreError("That payment doesn't match this order.");
  if (pi.status !== "succeeded") throw new StoreError(`Payment ${pi.status.replace(/_/g, " ")}.`);
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  await markCardPaymentSucceeded({ businessId: business.id, paymentIntentId: pi.id, chargeId: charge?.id ?? null, card: { brand: charge?.payment_method_details?.card?.brand ?? null, last4: charge?.payment_method_details?.card?.last4 ?? null }, taxRateBps: business.taxRateBps });
  after(() => sendOrderEmailsOnce(business.id, saleId).catch((e) => console.error("[store] order emails failed", saleId, (e as Error).message)));
  return getOrder(business.id, saleId);
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
