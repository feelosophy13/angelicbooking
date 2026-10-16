"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, normalizePhone, parseMoney } from "@angelic/core";
import { PermissionError, requireAction, requireBusiness } from "@/lib/tenant";
import { isStripeConfigured, StripeNotConfigured } from "@/lib/stripe";
import {
  addProductLine,
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
import { addServiceLine, applyPromoToSale, payWithStoreCredit, refundToStoreCredit, removePromoFromSale, setSaleClient, updateLine } from "@/server/sales";
import { schema as dbSchema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { queueOneOff } from "@/lib/notify";
import { receiptEmail } from "@/lib/notify/templates";
import { setFlash } from "@/lib/flash";
import { formatMoney } from "@/lib/utils";
import { getSale } from "@/server/sales";
import { paymentContextForSale } from "@/server/locations";
import { browserStripe } from "@/lib/stripe-demo";
import { TerminalError, terminalConnectionToken, terminalLocationFor } from "@/server/stripe-terminal";
import { findProductByCode, InventoryError, returnToShelf } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";

export type SaleActionState = { error?: string; ok?: boolean } | undefined;

const base = z.object({ slug: z.string(), saleId: z.string().min(1) });

function friendly(e: unknown): SaleActionState {
  if (e instanceof SaleError || e instanceof StripeNotConfigured || e instanceof StoreCreditError) return { error: e.message };
  throw e;
}

/** Refunds: whoever can see the sales reports, or has the separate Refund permission. */
async function requireRefund(slug: string) {
  const ctx = await requireBusiness(slug);
  if (!can(ctx.permissions, "reports.view") && !can(ctx.permissions, "checkout.refund")) throw new PermissionError();
  return ctx;
}

async function ctxFor(slug: string) {
  return requireAction(slug, "checkout.take");
}

export async function addProduct(formData: FormData) {
  const d = base.extend({ productId: z.string().min(1), quantity: z.coerce.number().int().min(1).max(99).default(1), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  await addProductLine({ businessId: ctx.business.id, saleId: d.saleId, productId: d.productId, quantity: d.quantity, staffId: d.staffId || null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** A scanner (or a typed SKU) adds one of that product to the ticket. */
export async function addProductByCode(formData: FormData) {
  const d = base.extend({ code: z.string().trim().min(1).max(60) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  const product = await findProductByCode(ctx.business.id, d.code);
  if (!product || product.kind !== "retail") await setFlash(`No product with the barcode or SKU "${d.code}".`, "error");
  else {
    try {
      await addProductLine({ businessId: ctx.business.id, saleId: d.saleId, productId: product.id, quantity: 1, staffId: null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
      await setFlash(`${productLabel(product)} added`, "success");
    } catch (e) {
      if (e instanceof SaleError) await setFlash(e.message, "error");
      else throw e;
    }
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
  const ctx = await ctxFor(d.slug);
  await removeLine({ businessId: ctx.business.id, saleId: d.saleId, lineId: d.lineId, taxRateBps: ctx.business.taxRateBps });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function applyDiscount(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ type: z.enum(["amount", "percent", "none"]), value: z.string().optional(), note: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const d = base.extend({ method: z.enum(["cash", "other"]), amount: z.string(), tendered: z.string().optional(), note: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter the amount received." };
  // Cash handed over beyond the amount: remember it and the change given back on the payment.
  const given = d.method === "cash" && d.tendered ? parseMoney(d.tendered) : null;
  if (given !== null && given < cents) return { error: "The cash received is less than the amount being paid." };
  const cashNote = given !== null && given > cents ? `Received ${formatMoney(given, ctx.business.currency)}, change ${formatMoney(given - cents, ctx.business.currency)}` : null;
  try {
    await recordManualPayment({ businessId: ctx.business.id, saleId: d.saleId, method: d.method, amountCents: cents, note: [d.note?.trim(), cashNote].filter(Boolean).join(" · ") || null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function payWithSavedCard(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ paymentMethodId: z.string().min(1), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const d = base.extend({ paymentId: z.string().min(1), amount: z.string(), reasonId: z.string().min(1, "Pick a reason."), note: z.string().optional(), to: z.enum(["original", "store_credit"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Pick a reason for the refund." };
  const ctx = await requireRefund(d.data.slug); // reports.view or the Refund permission
  const cents = parseMoney(d.data.amount);
  if (cents === null || cents <= 0) return { error: "Enter a refund amount." };
  const note = d.data.note?.trim() || null;
  try {
    if (d.data.to === "store_credit") {
      await refundToStoreCredit({ businessId: ctx.business.id, paymentId: d.data.paymentId, amountCents: cents, reason: note, reasonId: d.data.reasonId, actorUserId: ctx.user.id });
    } else {
      const pay = await paymentContextForSale(ctx.business, d.data.saleId);
      await refundPayment({ businessId: ctx.business.id, accountId: pay.accountId, paymentId: d.data.paymentId, amountCents: cents, reason: note, reasonId: d.data.reasonId, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
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
  const ctx = await requireRefund(d.slug);
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
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
  await voidSale({ businessId: ctx.business.id, saleId: d.saleId, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function addOffer(formData: FormData) {
  const d = base.extend({ kind: z.enum(["gift_card", "package", "membership"]), refId: z.string().optional(), amount: z.string().optional(), recipientName: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  try {
    await addOfferLine({ businessId: ctx.business.id, saleId: d.saleId, kind: d.kind, refId: d.refId || null, amountCents: d.amount ? parseMoney(d.amount) : null, recipientName: d.recipientName?.trim() || null });
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

export async function removePromo(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  await removePromoFromSale({ businessId: ctx.business.id, saleId: d.saleId, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function payWithGiftCard(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ code: z.string().min(4), amount: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
  await redeemCredit({ businessId: ctx.business.id, saleId: d.saleId, lineId: d.lineId, source: d.source, sourceId: d.sourceId, actorUserId: ctx.user.id });
  await settleIfPaid(ctx.business.id, d.saleId, ctx.user.id, ctx.business.taxRateBps);
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** Email or text a receipt for a closed sale: to the client on the ticket, or to any address or number typed at the desk. */
export async function sendReceipt(formData: FormData) {
  const d = base.extend({ channel: z.enum(["email", "sms"]), to: z.string().trim().max(200) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
    payments: payments.filter((p) => p.status !== "failed" && p.status !== "pending").map((p) => ({ label: `${p.method.replace("_", " ")}${p.cardLast4 ? ` ****${p.cardLast4}` : ""}`, amount: m(p.amountCents) })),
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
  const ctx = await ctxFor(d.slug);
  try {
    await setSaleNotes({ businessId: ctx.business.id, saleId: d.saleId, notes: d.notes?.trim() || null, actorUserId: ctx.user.id });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

export async function toggleTaxExempt(formData: FormData) {
  const d = base.extend({ exempt: z.enum(["1", "0"]) }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  await setTaxExempt({ businessId: ctx.business.id, saleId: d.saleId, exempt: d.exempt === "1", actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

/** Close a ticket with nothing to pay (a comp, or fully covered by a package or discount). */
export async function completeSale(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.data.slug);
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
  const ctx = await ctxFor(d.data.slug);
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
  const ctx = await ctxFor(d.slug);
  await withTenant(ctx.business.id, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(dbSchema.sales.id, d.saleId) });
    if (!sale?.fulfillment) return;
    await tx.update(dbSchema.sales).set({ fulfillment: { ...sale.fulfillment, status: d.status } }).where(eq(dbSchema.sales.id, d.saleId));
  });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function attachClient(formData: FormData) {
  const d = base.extend({ clientId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
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
  const ctx = await ctxFor(d.slug);
  const price = d.price?.trim() ? parseMoney(d.price) : null;
  if (d.price?.trim() && price === null) {
    await setFlash("Enter a price like 65 or 65.50.", "error");
    revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
    return;
  }
  try {
    await addServiceLine({ businessId: ctx.business.id, saleId: d.saleId, serviceId: d.serviceId, staffId: d.staffId || null, priceCents: price, taxRateBps: ctx.business.taxRateBps, actorUserId: ctx.user.id });
  } catch (e) {
    if (e instanceof SaleError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}

export async function editLine(formData: FormData) {
  const d = base.extend({ lineId: z.string().min(1), price: z.string().optional(), quantity: z.string().optional(), staffId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  const unit = d.price?.trim() ? parseMoney(d.price) : null;
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
