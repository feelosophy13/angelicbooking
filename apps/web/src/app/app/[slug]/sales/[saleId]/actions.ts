"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, normalizePhone, parseMoney } from "@angelic/core";
import { PermissionError, requireAction, requireBusiness } from "@/lib/tenant";
import { salesScope } from "@/lib/visibility";
import { isStripeConfigured, StripeNotConfigured } from "@/lib/stripe";
import {
  addProductLine,
  addTipAfterPayment,
  chargeCardOnFile,
  completeNoCharge,
  setSaleNotes,
  setTaxExempt,
  createCardPaymentIntent,
  markCardPaymentSucceeded,
  recordManualPayment,
  refundPayment,
  removeLine,
  SaleError,
  setDiscount,
  setTips,
  settleIfPaid,
  voidSale,
} from "@/server/sales";
import { stripe } from "@/lib/stripe";
import { addOfferLine, redeemCredit, redeemGiftCard } from "@/server/offers";
import { LoyaltyError, redeemPoints, referralPitch, referralsEnabled } from "@/server/loyalty";
import { StoreCreditError } from "@/server/store-credit";
import { RefundReasonError, updateRefundReason } from "@/server/refund-reasons";
import { PromoError } from "@/server/promos";
import { addServiceLine, applyPromoToSale, payWithStoreCredit, refundToStoreCredit, removePromoFromSale, setSaleClient, updateLine, type RefundItemInput } from "@/server/sales";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { queueOneOff } from "@/lib/notify";
import { receiptEmail } from "@/lib/notify/templates";
import { setFlash } from "@/lib/flash";
import { formatMoney } from "@/lib/utils";
import { discardEmptySale, getSale, isOwnSale, openWalkInSale } from "@/server/sales";
import { paymentContextForSale } from "@/server/locations";
import { browserStripe } from "@/lib/stripe-demo";
import { TerminalError, terminalConnectionToken, terminalLocationFor } from "@/server/stripe-terminal";
import { findProductByCode, InventoryError, returnToShelf } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { paymentMethodLabel } from "@/lib/payment-methods";

export type SaleActionState = { error?: string; ok?: boolean } | undefined;

// The blank checkout page posts NEW_SALE with the client and location chosen there; the other forms post a ticket's id.
const base = z.object({ slug: z.string(), saleId: z.string().min(1), clientId: z.string().optional(), locationId: z.string().optional() });

/** The blank checkout page's ticket id. Nothing is saved until the first item goes on, so an abandoned "+ Sale" leaves no ticket behind. */
const NEW_SALE = "new";

function friendly(e: unknown): SaleActionState {
  if (e instanceof SaleError || e instanceof StripeNotConfigured || e instanceof StoreCreditError) return { error: e.message };
  throw e;
}

/**
 * Refunds need the Refund permission itself, on a ticket the person may see (M2): any ticket with "See every ticket", otherwise only one
 * they are credited on. Being able to read reports doesn't let someone send money back.
 */
async function requireRefund(slug: string, saleId: string) {
  const ctx = await requireBusiness(slug);
  if (!can(ctx.permissions, "checkout.refund")) throw new PermissionError();
  if (salesScope(ctx.permissions) !== "all" && !(await isOwnSale(ctx.business.id, saleId, { staffId: ctx.staffId, userId: ctx.user.id }))) throw new PermissionError();
  return ctx;
}

/**
 * Anyone who takes payments, on a ticket they may see (M1): without "See every ticket" they work only on tickets they are credited on (or
 * just opened and not yet filled; the same rule as the Sales list), so a stylist can't open, edit or tip themselves on a colleague's ticket.
 */
async function ctxFor(slug: string, saleId: string) {
  const ctx = await requireAction(slug, "checkout.take");
  // A ticket that doesn't exist yet will be theirs: they ring it up.
  if (saleId !== NEW_SALE && salesScope(ctx.permissions) !== "all" && !(await isOwnSale(ctx.business.id, saleId, { staffId: ctx.staffId, userId: ctx.user.id }))) throw new PermissionError();
  return ctx;
}

type Ctx = Awaited<ReturnType<typeof ctxFor>>;

/** The ticket to add to: the one posted, or, from the blank checkout page, a new one opened now for its first item. */
async function ticketFor(ctx: Ctx, d: { saleId: string; clientId?: string; locationId?: string }) {
  if (d.saleId !== NEW_SALE) return d.saleId;
  return openWalkInSale({ businessId: ctx.business.id, actorUserId: ctx.user.id, currency: ctx.business.currency, clientId: d.clientId || null, locationId: d.locationId || null });
}

/** After a first add from the blank page: on to the new ticket, or, when that add failed, take the empty ticket back and stay put. */
async function landOnTicket(ctx: Ctx, d: { slug: string; saleId: string }, saleId: string) {
  if (d.saleId !== NEW_SALE) return;
  if (await discardEmptySale(ctx.business.id, saleId)) return;
  redirect(`/app/${d.slug}/sales/${saleId}`);
}

/** Discounts, price changes and voids need their own permission. */
async function discountCtx(slug: string, saleId: string) {
  const ctx = await ctxFor(slug, saleId);
  if (!can(ctx.permissions, "checkout.discount")) throw new PermissionError();
  return ctx;
}

/** Who gets credit for a line: a chosen person, or "none" on purpose. There is no default, so a missing choice is an error, not a guess. */
function creditFrom(v: string | undefined): { ok: true; staffId: string | null } | { ok: false } {
  if (v === "none") return { ok: true, staffId: null };
  return v ? { ok: true, staffId: v } : { ok: false };
}

export async function addProduct(formData: FormData) {
  const d = base.extend({ productId: z.string().min(1), quantity: z.coerce.number().int().min(1).max(99).default(1), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const credit = creditFrom(d.staffId);
  if (!credit.ok) {
    await setFlash("Choose who gets credit for it first (or \"No staff credit\").", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const saleId = await ticketFor(ctx, d);
  try {
    await addProductLine({ businessId: ctx.business.id, saleId, productId: d.productId, quantity: d.quantity, staffId: credit.staffId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    if (!(e instanceof SaleError)) throw e;
    await setFlash(e.message, "error");
  }
  await landOnTicket(ctx, d, saleId);
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** A scanner (or a typed SKU) adds one of that product to the ticket. */
export async function addProductByCode(formData: FormData) {
  const d = base.extend({ code: z.string().trim().max(60), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  if (!d.code) {
    await setFlash("Scan a barcode or type a SKU first.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const credit = creditFrom(d.staffId);
  if (!credit.ok) {
    await setFlash("Choose who gets credit first, then scan.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const product = await findProductByCode(ctx.business.id, d.code);
  if (!product || product.kind !== "retail") await setFlash(`No product with the barcode or SKU "${d.code}".`, "error");
  else {
    const saleId = await ticketFor(ctx, d);
    try {
      await addProductLine({ businessId: ctx.business.id, saleId, productId: product.id, quantity: 1, staffId: credit.staffId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
      await setFlash(`${productLabel(product)} added`, "success");
    } catch (e) {
      if (e instanceof SaleError) await setFlash(e.message, "error");
      else throw e;
    }
    await landOnTicket(ctx, d, saleId);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** A client brought goods back: put them on the shelf. Refunding does not do this by itself. */
export async function putBackOnShelf(formData: FormData) {
  const d = base.extend({ note: z.string().trim().max(120).optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "inventory.manage");
  const items: { productId: string; qty: number }[] = [];
  for (const [key, v] of formData.entries()) {
    if (!key.startsWith("back:")) continue;
    const qty = Number(String(v));
    if (Number.isInteger(qty) && qty > 0) items.push({ productId: key.slice(5), qty });
  }
  try {
    await returnToShelf({ businessId: ctx.business.id, saleId: d.saleId, items, note: d.note || null, actorUserId: ctx.user.id });
    await setFlash("Back on the shelf", "success");
  } catch (e) {
    if (e instanceof InventoryError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function deleteLine(formData: FormData) {
  const d = base.extend({ lineId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  await removeLine({ businessId: ctx.business.id, saleId: d.saleId, lineId: d.lineId, taxRateBps: ctx.business.taxRateBps });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function applyDiscount(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ type: z.enum(["amount", "percent", "none"]), value: z.string().optional(), note: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await discountCtx(d.slug, d.saleId);
  try {
    let discount = null;
    if (d.type === "percent") {
      const pct = Number(d.value);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: "Enter a percent between 1 and 100." };
      discount = { type: "percent" as const, value: pct };
    } else if (d.type === "amount") {
      const cents = parseMoney(d.value);
      if (cents === null || cents <= 0) return { error: "Enter an amount like 10 or 10.50." };
      discount = { type: "amount" as const, value: cents };
    }
    await setDiscount({ businessId: ctx.business.id, saleId: d.saleId, discount, note: d.note?.trim() || null, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

export async function applyTips(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  // Setting tips while the ticket is open is part of checking out; changing them once it is paid is "Add or move tips after payment" (M5).
  const current = await withTenant(ctx.business.id, (tx) => tx.query.sales.findFirst({ where: eq(dbSchema.sales.id, d.saleId), columns: { status: true } }));
  if (current && current.status !== "open" && !can(ctx.permissions, "checkout.tips.adjust")) throw new PermissionError();
  const tips: { staffId: string | null; amountCents: number; method: "cash" | "card" | null }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("tip_")) continue;
    const cents = parseMoney(String(v));
    if (cents === null) {
      if (String(v).trim() !== "") return { error: "Tips must be amounts like 10 or 10.50." };
      continue;
    }
    const who = k === "tip_" ? "" : k.slice(4);
    const how = String(formData.get(`tipby_${who}`) ?? "");
    tips.push({ staffId: who || null, amountCents: cents, method: how === "cash" || how === "card" ? how : null });
  }
  try {
    await setTips({ businessId: ctx.business.id, saleId: d.saleId, tips, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

export async function payManual(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ method: z.enum(["cash", "other", "external_card"]), amount: z.string(), tendered: z.string().optional(), note: z.string().optional(), last4: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter the amount received." };
  // Cash handed over beyond the amount: remember it and the change given back on the payment.
  const given = d.method === "cash" && d.tendered ? parseMoney(d.tendered) : null;
  if (given !== null && given < cents) return { error: "The cash received is less than the amount being paid." };
  const last4 = d.method === "external_card" ? (d.last4 ?? "").replace(/\D/g, "") : "";
  if (last4 && last4.length !== 4) return { error: "The last four digits are four numbers, or leave it blank." };
  const cashNote = given !== null && given > cents ? `Received ${formatMoney(given, ctx.business.currency)}, change ${formatMoney(given - cents, ctx.business.currency)}` : null;
  try {
    await recordManualPayment({ businessId: ctx.business.id, saleId: d.saleId, method: d.method, amountCents: cents, note: [d.note?.trim(), cashNote].filter(Boolean).join(" · ") || null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, cardLast4: last4 || null });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function payWithSavedCard(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ paymentMethodId: z.string().min(1), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    await chargeCardOnFile({ businessId: ctx.business.id, accountId: pay.accountId, saleId: d.saleId, paymentMethodId: d.paymentMethodId, amountCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

/** Step 1 of a new-card payment: create the PaymentIntent and hand the client secret to the browser. */
export async function startCardPayment(input: { slug: string; saleId: string; amount: string; saveCard: boolean }): Promise<{ clientSecret: string; accountId: string | null; publishableKey: string | null; amount: number } | { error: string }> {
  const d = base.extend({ amount: z.string(), saveCard: z.boolean() }).parse(input);
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  if (!isStripeConfigured()) return { error: "Stripe is not configured on the server." };
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    const r = await createCardPaymentIntent({ businessId: ctx.business.id, accountId: pay.accountId, saleId: d.saleId, amountCents: cents, saveCard: d.saveCard, actorUserId: ctx.user.id });
    const browser = await browserStripe(pay.accountId, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    return { clientSecret: r.clientSecret, accountId: browser.stripeAccount, publishableKey: browser.publishableKey, amount: r.amount };
  } catch (e) {
    const f = friendly(e);
    return { error: f?.error ?? "Could not start payment" };
  }
}

/** Card reader (Stripe Terminal): a connection token for the browser SDK. The SDK asks again whenever it needs a fresh one. */
export async function terminalToken(input: { slug: string; saleId: string }): Promise<{ secret: string } | { error: string }> {
  const d = base.parse(input);
  const ctx = await ctxFor(d.slug, d.saleId);
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    return { secret: await terminalConnectionToken(pay.accountId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach Stripe." };
  }
}

/** The Terminal location to look for readers under, for the sale's salon location. */
export async function terminalLocation(input: { slug: string; saleId: string }): Promise<{ locationId: string } | { error: string }> {
  const d = base.parse(input);
  const ctx = await ctxFor(d.slug, d.saleId);
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    return { locationId: await terminalLocationFor(pay.accountId, pay) };
  } catch (e) {
    if (e instanceof TerminalError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Could not reach Stripe." };
  }
}

/** Card reader step 1: a card-present PaymentIntent for the amount. The reader collects and processes it; finishCardPayment then records it. */
export async function startTerminalPayment(input: { slug: string; saleId: string; amount: string; saveCard?: boolean }): Promise<{ clientSecret: string } | { error: string }> {
  const d = base.extend({ amount: z.string(), saveCard: z.boolean().optional() }).parse(input);
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  if (!isStripeConfigured()) return { error: "Stripe is not configured on the server." };
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    const r = await createCardPaymentIntent({ businessId: ctx.business.id, accountId: pay.accountId, saleId: d.saleId, amountCents: cents, saveCard: !!d.saveCard, actorUserId: ctx.user.id, terminal: true });
    return { clientSecret: r.clientSecret };
  } catch (e) {
    const f = friendly(e);
    return { error: f?.error ?? "Could not start the payment" };
  }
}

/** Step 2: the browser confirmed the PaymentIntent. Verify with Stripe and record it (webhook also does this). */
export async function finishCardPayment(input: { slug: string; saleId: string; paymentIntentId: string }): Promise<SaleActionState> {
  const d = base.extend({ paymentIntentId: z.string().min(1) }).parse(input);
  const ctx = await ctxFor(d.slug, d.saleId);
  const pay = await paymentContextForSale(ctx.business, d.saleId);
  if (!pay.accountId) return { error: "Stripe not connected." };
  const pi = await stripe().paymentIntents.retrieve(d.paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: pay.accountId });
  if (pi.metadata.saleId !== d.saleId) return { error: "Payment does not belong to this sale." };
  if (pi.status !== "succeeded") return { error: `Payment status: ${pi.status}` };
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  await markCardPaymentSucceeded({
    businessId: ctx.business.id,
    paymentIntentId: pi.id,
    chargeId: charge?.id ?? null,
    card: { brand: (charge?.payment_method_details?.card ?? charge?.payment_method_details?.card_present)?.brand ?? null, last4: (charge?.payment_method_details?.card ?? charge?.payment_method_details?.card_present)?.last4 ?? null }, // a tapped or dipped card is reported as card_present
    taxRateBps: ctx.business.taxRateBps,
  });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function refund(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ paymentId: z.string().min(1), amount: z.string().optional(), reasonId: z.string().min(1, "Pick a reason for the refund."), note: z.string().optional(), to: z.enum(["original", "store_credit"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Check the refund details." };
  const ctx = await requireRefund(d.data.slug, d.data.saleId);
  // Items being refunded ("item:<line id>" = amount, "qty:<line id>" = how many); with none, the amount is a refund off the whole ticket.
  const items: RefundItemInput[] = [];
  for (const [key, v] of formData.entries()) {
    if (!key.startsWith("item:") || !String(v).trim()) continue;
    const c = parseMoney(String(v));
    if (c === null || c < 0) return { error: "Enter amounts like 30.00 for the items being refunded." };
    if (c === 0) continue;
    const lineId = key.slice(5);
    const qty = Number(formData.get(`qty:${lineId}`) ?? "");
    items.push({ saleLineId: lineId, amountCents: c, quantity: Number.isInteger(qty) && qty > 0 ? qty : undefined });
  }
  const cents = items.length ? items.reduce((n, i) => n + i.amountCents, 0) : parseMoney(d.data.amount ?? "");
  if (cents === null || cents <= 0) return { error: "Enter a refund amount." };
  const note = d.data.note?.trim() || null;
  try {
    if (d.data.to === "store_credit") {
      await refundToStoreCredit({ businessId: ctx.business.id, paymentId: d.data.paymentId, amountCents: cents, reason: note, reasonId: d.data.reasonId, actorUserId: ctx.user.id, items });
    } else {
      const pay = await paymentContextForSale(ctx.business, d.data.saleId);
      await refundPayment({ businessId: ctx.business.id, accountId: pay.accountId, paymentId: d.data.paymentId, amountCents: cents, reason: note, reasonId: d.data.reasonId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps, items });
    }
  } catch (e) {
    return friendly(e);
  }
  // Goods the client brought back go back on the shelf (only when asked for; a refund alone never touches the stock).
  const back: { productId: string; qty: number }[] = [];
  for (const [key, v] of formData.entries()) {
    const qty = Number(String(v));
    if (key.startsWith("back:") && Number.isInteger(qty) && qty > 0) back.push({ productId: key.slice(5), qty });
  }
  if (back.length) {
    try {
      await returnToShelf({ businessId: ctx.business.id, saleId: d.data.saleId, items: back, note: "Returned with refund", actorUserId: ctx.user.id });
    } catch (e) {
      revalidatePath(`/app/${d.data.slug}/sales/${d.data.saleId}`);
      if (e instanceof InventoryError) return { error: `The refund was made, but the goods weren't put back on the shelf: ${e.message}` };
      throw e;
    }
  }
  revalidatePath(`/app/${d.data.slug}/sales/${d.data.saleId}`);
  return { ok: true };
}

/** Change the reason or note on a refund that already happened. Logged; the money is untouched. */
export async function changeRefundReason(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ kind: z.enum(["refund", "credit"]), id: z.string().min(1), reasonId: z.string().optional(), note: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireRefund(d.slug, d.saleId);
  try {
    await updateRefundReason({ businessId: ctx.business.id, kind: d.kind, id: d.id, reasonId: d.reasonId || null, note: d.note?.trim() || null, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof RefundReasonError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

export async function payWithStoreCreditAction(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  try {
    await payWithStoreCredit({ businessId: ctx.business.id, saleId: d.saleId, amountCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function voidOpenSale(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await discountCtx(d.slug, d.saleId);
  await voidSale({ businessId: ctx.business.id, saleId: d.saleId, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function addOffer(formData: FormData) {
  const d = base.extend({ kind: z.enum(["gift_card", "package", "membership"]), refId: z.string().optional(), amount: z.string().optional(), recipientName: z.string().optional(), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  // A package earns its seller commission, so who sold it must be chosen (no default); gift cards and memberships earn none.
  const credit = d.kind === "package" ? creditFrom(d.staffId) : { ok: true as const, staffId: null };
  if (!credit.ok) {
    await setFlash("Choose who sold the package first (or \"No staff credit\").", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const saleId = await ticketFor(ctx, d);
  try {
    await addOfferLine({ businessId: ctx.business.id, saleId, kind: d.kind, refId: d.refId || null, amountCents: d.amount ? parseMoney(d.amount) : null, recipientName: d.recipientName?.trim() || null, staffId: credit.staffId });
  } catch (e) {
    if (!(e instanceof SaleError)) throw e;
    await setFlash(e.message, "error");
  }
  await landOnTicket(ctx, d, saleId);
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function removePromo(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  await removePromoFromSale({ businessId: ctx.business.id, saleId: d.saleId, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function payWithGiftCard(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ code: z.string().min(4), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  try {
    await redeemGiftCard({ businessId: ctx.business.id, saleId: d.saleId, code: d.code, amountCents: cents, actorUserId: ctx.user.id });
    await settleIfPaid(ctx.business.id, d.saleId, ctx.user.id, ctx.business.taxRateBps);
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function useCredit(formData: FormData) {
  const d = base.extend({ lineId: z.string().min(1), source: z.enum(["package", "membership"]), sourceId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  await redeemCredit({ businessId: ctx.business.id, saleId: d.saleId, lineId: d.lineId, source: d.source, sourceId: d.sourceId, actorUserId: ctx.user.id });
  await settleIfPaid(ctx.business.id, d.saleId, ctx.user.id, ctx.business.taxRateBps);
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** Email or text a receipt for a closed sale: to the client on the ticket, or to any address or number typed at the desk. */
export async function sendReceipt(formData: FormData) {
  const d = base.extend({ channel: z.enum(["email", "sms"]), to: z.string().trim().max(200) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const back = () => revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  const data = await getSale(ctx.business.id, d.saleId);
  if (!data || data.sale.status === "open") {
    await setFlash("Receipts go out once the sale is paid.", "error");
    back();
    return;
  }
  const { sale, lines, payments, client } = data;
  const b = ctx.business;
  // The receipt names the merchant that took the money: the location when it has its own Stripe account.
  const pay = await paymentContextForSale(b, sale.id);
  const m = (c: number) => formatMoney(c, b.currency);
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: b.timezone }).format(sale.closedAt ?? sale.createdAt);
  if (d.channel === "sms") {
    const phone = normalizePhone(d.to);
    if (!phone) {
      await setFlash("Enter a mobile number to text the receipt to.", "error");
      back();
      return;
    }
    const text = `${pay.name}: receipt #${sale.number}, ${when}. ${lines.filter((l) => l.kind !== "tip").map((l) => `${l.name}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join(", ")}. Total ${m(sale.totalCents)}${sale.tipCents ? ` (incl. ${m(sale.tipCents)} tip)` : ""}. Thank you!${b.receiptFooter ? ` ${b.receiptFooter.replace(/\s+/g, " ").trim()}` : ""}`;
    await queueOneOff(b.id, { channel: "sms", template: "receipt", recipient: phone, body: text.slice(0, 600), clientId: client?.id ?? null, locationId: sale.locationId });
    await setFlash(`Receipt texted to ${phone}`);
    back();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)) {
    await setFlash("Enter a valid email address.", "error");
    back();
    return;
  }
  const t = receiptEmail({
    businessName: pay.name,
    logoUrl: b.logoUrl,
    brandColor: b.brandColor,
    businessPhone: pay.phone,
    address: pay.addressLine,
    number: sale.number,
    when,
    clientName: client ? `${client.firstName} ${client.lastName ?? ""}`.trim() : null,
    lines: lines.filter((l) => l.kind !== "tip").map((l) => ({ name: l.name, quantity: l.quantity, amount: m(l.amountCents) })),
    subtotal: m(sale.subtotalCents),
    discount: sale.discountCents ? m(sale.discountCents) : null,
    tax: sale.taxCents ? m(sale.taxCents) : null,
    taxRate: sale.taxCents ? `${(pay.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%` : null,
    tip: sale.tipCents ? m(sale.tipCents) : null,
    total: m(sale.totalCents),
    payments: payments.filter((p) => p.status !== "failed" && p.status !== "pending").map((p) => ({ label: `${paymentMethodLabel(p.method)}${p.cardLast4 ? ` ****${p.cardLast4}` : ""}`, amount: m(p.amountCents) })),
    refunded: sale.refundedCents ? m(sale.refundedCents) : null,
    footer: b.receiptFooter,
    referral: client && referralsEnabled(b) && client.referralCode ? referralPitch(b, client.referralCode) : null,
  });
  await queueOneOff(b.id, { channel: "email", template: "receipt", recipient: d.to, subject: t.subject, body: t.html, clientId: client?.id ?? null, locationId: sale.locationId });
  await setFlash(`Receipt emailed to ${d.to}`);
  back();
}

/** A private note on the ticket. */
export async function saveSaleNote(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ notes: z.string().max(1000).optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  try {
    await setSaleNotes({ businessId: ctx.business.id, saleId: d.saleId, notes: d.notes?.trim() || null, actorUserId: ctx.user.id });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

/** Tax-exempt is a price change (M5): the discount permission. */
export async function toggleTaxExempt(formData: FormData) {
  const d = base.extend({ exempt: z.enum(["1", "0"]) }).parse(Object.fromEntries(formData));
  const ctx = await discountCtx(d.slug, d.saleId);
  await setTaxExempt({ businessId: ctx.business.id, saleId: d.saleId, exempt: d.exempt === "1", actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** Close a ticket with nothing to pay (a comp, or fully covered by a package or discount). */
export async function completeSale(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  try {
    await completeNoCharge({ businessId: ctx.business.id, saleId: d.saleId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    await setFlash("Sale completed", "success");
  } catch (e) {
    if (e instanceof SaleError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
}

export async function payWithPoints(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ points: z.coerce.number().int().min(1) }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Enter how many points to redeem." };
  const ctx = await ctxFor(d.data.slug, d.data.saleId);
  try {
    await redeemPoints({ business: ctx.business, saleId: d.data.saleId, points: d.data.points, actorUserId: ctx.user.id });
    await settleIfPaid(ctx.business.id, d.data.saleId, ctx.user.id, ctx.business.taxRateBps);
  } catch (e) {
    if (e instanceof LoyaltyError) return { error: e.message };
    return friendly(e);
  }
  revalidatePath(`/app/${d.data.slug}/sales/${d.data.saleId}`);
  revalidatePath(`/app/${d.data.slug}`);
  return { ok: true };
}

export async function applyPromo(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ code: z.string().trim().min(1, "Enter a code") }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Enter a promo code." };
  const ctx = await ctxFor(d.data.slug, d.data.saleId);
  try {
    await applyPromoToSale({ businessId: ctx.business.id, saleId: d.data.saleId, code: d.data.code, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof PromoError) return { error: e.message };
    return friendly(e);
  }
  revalidatePath(`/app/${d.data.slug}/sales/${d.data.saleId}`);
  return { ok: true };
}

/** Online orders: move pickup/shipping status along. */
export async function setFulfillment(formData: FormData) {
  const d = base.extend({ status: z.enum(["pending", "ready", "done"]) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  await withTenant(ctx.business.id, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(dbSchema.sales.id, d.saleId) });
    if (!sale?.fulfillment) return;
    await tx.update(dbSchema.sales).set({ fulfillment: { ...sale.fulfillment, status: d.status } }).where(eq(dbSchema.sales.id, d.saleId));
  });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function attachClient(formData: FormData) {
  const d = base.extend({ clientId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  try {
    await setSaleClient({ businessId: ctx.business.id, saleId: d.saleId, clientId: d.clientId || null, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof SaleError) {
      await setFlash(e.message, "error");
      revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
      return;
    }
    throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function addServiceToSale(formData: FormData) {
  const d = base.extend({ serviceId: z.string().min(1), staffId: z.string().optional(), price: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const credit = creditFrom(d.staffId);
  if (!credit.ok) {
    await setFlash("Choose who performed it first (or \"No staff credit\").", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const price = d.price?.trim() ? parseMoney(d.price) : null;
  if (d.price?.trim() && price === null) {
    await setFlash("Enter a price like 65 or 65.50.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  const saleId = await ticketFor(ctx, d);
  try {
    await addServiceLine({ businessId: ctx.business.id, saleId, serviceId: d.serviceId, staffId: credit.staffId, priceCents: price, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof SaleError) await setFlash(e.message, "error");
    else throw e;
  }
  await landOnTicket(ctx, d, saleId);
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function editLine(formData: FormData) {
  const d = base.extend({ lineId: z.string().min(1), price: z.string().optional(), quantity: z.string().optional(), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug, d.saleId);
  const unit = d.price?.trim() ? parseMoney(d.price) : null;
  // Changing a price is a discount; moving credit to someone else is for those who see everyone's work.
  const line = await withTenant(ctx.business.id, (tx) => tx.query.saleLines.findFirst({ where: eq(dbSchema.saleLines.id, d.lineId) }));
  if (!line || line.saleId !== d.saleId) throw new PermissionError();
  if (unit !== null && unit !== line.unitCents && !can(ctx.permissions, "checkout.discount")) {
    await setFlash("Changing a price needs the discounts permission.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  if (d.staffId !== undefined && (d.staffId || null) !== line.staffId && salesScope(ctx.permissions) !== "all") {
    await setFlash("Only someone who sees every calendar can move credit between staff.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  if (d.price?.trim() && unit === null) {
    await setFlash("Enter a price like 65 or 65.50.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  try {
    await updateLine({ businessId: ctx.business.id, saleId: d.saleId, lineId: d.lineId, unitCents: unit, quantity: d.quantity ? Number(d.quantity) : null, staffId: d.staffId === undefined ? undefined : d.staffId || null, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof SaleError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** A tip that comes after the sale was paid: in cash, or on a card the client has on file. */
export async function addLateTip(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ staffId: z.string().min(1, "Choose who the tip is for."), amount: z.string(), paidIn: z.string().min(1) }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Check the tip details." };
  const ctx = await ctxFor(d.data.slug, d.data.saleId);
  // A tip on a ticket that is already paid is "Add or move tips after payment" (M5).
  if (!can(ctx.permissions, "checkout.tips.adjust")) throw new PermissionError();
  const cents = parseMoney(d.data.amount);
  if (cents === null || cents <= 0) return { error: "Enter a tip amount like 5 or 7.50." };
  try {
    if (d.data.paidIn === "cash") {
      await addTipAfterPayment({ businessId: ctx.business.id, saleId: d.data.saleId, staffId: d.data.staffId, amountCents: cents, method: "cash", actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    } else {
      const pay = await paymentContextForSale(ctx.business, d.data.saleId);
      if (!pay.accountId || !pay.chargesEnabled) return { error: "Connect Stripe under Settings → Payments to charge a card." };
      await addTipAfterPayment({ businessId: ctx.business.id, saleId: d.data.saleId, staffId: d.data.staffId, amountCents: cents, method: "card", paymentMethodId: d.data.paidIn, accountId: pay.accountId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
    }
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.data.slug}/sales/${d.data.saleId}`);
  revalidatePath(`/app/${d.data.slug}`);
  return { ok: true };
}
