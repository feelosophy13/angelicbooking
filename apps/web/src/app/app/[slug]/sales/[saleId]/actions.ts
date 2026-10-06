"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { isStripeConfigured, StripeNotConfigured } from "@/lib/stripe";
import {
  addProductLine,
  chargeCardOnFile,
  createCardPaymentIntent,
  markCardPaymentSucceeded,
  recordManualPayment,
  refundPayment,
  removeLine,
  SaleError,
  setDiscount,
  setTips,
  voidSale,
} from "@/server/sales";
import { stripe } from "@/lib/stripe";

export type SaleActionState = { error?: string; ok?: boolean } | undefined;

const base = z.object({ slug: z.string(), saleId: z.string().min(1) });

function friendly(e: unknown): SaleActionState {
  if (e instanceof SaleError || e instanceof StripeNotConfigured) return { error: e.message };
  throw e;
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
  const tips: { staffId: string | null; amountCents: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("tip_")) continue;
    const cents = parseMoney(String(v));
    if (cents === null) {
      if (String(v).trim() !== "") return { error: "Tips must be amounts like 10 or 10.50." };
      continue;
    }
    tips.push({ staffId: k === "tip_" ? null : k.slice(4), amountCents: cents });
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
  const d = base.extend({ method: z.enum(["cash", "other"]), amount: z.string(), note: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter the amount received." };
  try {
    await recordManualPayment({ businessId: ctx.business.id, saleId: d.saleId, method: d.method, amountCents: cents, note: d.note?.trim() || null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
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
  if (!ctx.business.stripeAccountId || !ctx.business.stripeChargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    await chargeCardOnFile({ businessId: ctx.business.id, accountId: ctx.business.stripeAccountId, saleId: d.saleId, paymentMethodId: d.paymentMethodId, amountCents: cents, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

/** Step 1 of a new-card payment: create the PaymentIntent and hand the client secret to the browser. */
export async function startCardPayment(input: { slug: string; saleId: string; amount: string; saveCard: boolean }): Promise<{ clientSecret: string; accountId: string; amount: number } | { error: string }> {
  const d = base.extend({ amount: z.string(), saveCard: z.boolean() }).parse(input);
  const ctx = await ctxFor(d.slug);
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter an amount." };
  if (!isStripeConfigured()) return { error: "Stripe is not configured on the server." };
  if (!ctx.business.stripeAccountId || !ctx.business.stripeChargesEnabled) return { error: "Connect Stripe under Settings → Payments first." };
  try {
    const r = await createCardPaymentIntent({ businessId: ctx.business.id, accountId: ctx.business.stripeAccountId, saleId: d.saleId, amountCents: cents, saveCard: d.saveCard, actorUserId: ctx.user.id });
    return { clientSecret: r.clientSecret, accountId: ctx.business.stripeAccountId, amount: r.amount };
  } catch (e) {
    const f = friendly(e);
    return { error: f?.error ?? "Could not start payment" };
  }
}

/** Step 2: the browser confirmed the PaymentIntent. Verify with Stripe and record it (webhook also does this). */
export async function finishCardPayment(input: { slug: string; saleId: string; paymentIntentId: string }): Promise<SaleActionState> {
  const d = base.extend({ paymentIntentId: z.string().min(1) }).parse(input);
  const ctx = await ctxFor(d.slug);
  if (!ctx.business.stripeAccountId) return { error: "Stripe not connected." };
  const pi = await stripe().paymentIntents.retrieve(d.paymentIntentId, { expand: ["latest_charge"] }, { stripeAccount: ctx.business.stripeAccountId });
  if (pi.metadata.saleId !== d.saleId) return { error: "Payment does not belong to this sale." };
  if (pi.status !== "succeeded") return { error: `Payment status: ${pi.status}` };
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  await markCardPaymentSucceeded({
    businessId: ctx.business.id,
    paymentIntentId: pi.id,
    chargeId: charge?.id ?? null,
    card: { brand: charge?.payment_method_details?.card?.brand ?? null, last4: charge?.payment_method_details?.card?.last4 ?? null },
    taxRateBps: ctx.business.taxRateBps,
  });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  revalidatePath(`/app/${d.slug}`);
  return { ok: true };
}

export async function refund(_prev: SaleActionState, formData: FormData): Promise<SaleActionState> {
  const d = base.extend({ paymentId: z.string().min(1), amount: z.string(), reason: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "reports.view"); // managers/owners only
  const cents = parseMoney(d.amount);
  if (cents === null || cents <= 0) return { error: "Enter a refund amount." };
  try {
    await refundPayment({ businessId: ctx.business.id, accountId: ctx.business.stripeAccountId, paymentId: d.paymentId, amountCents: cents, reason: d.reason?.trim() || null, actorUserId: ctx.user.id, taxRateBps: ctx.business.taxRateBps });
  } catch (e) {
    return friendly(e);
  }
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
  return { ok: true };
}

export async function voidOpenSale(formData: FormData) {
  const d = base.parse(Object.fromEntries(formData));
  const ctx = await ctxFor(d.slug);
  await voidSale({ businessId: ctx.business.id, saleId: d.saleId, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/sales/${d.saleId}`);
}
