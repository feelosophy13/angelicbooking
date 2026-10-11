"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { disconnectConnectAccount, startConnectOnboarding, syncConnectAccount } from "@/server/stripe-connect";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { createRefundReason, moveRefundReason, renameRefundReason, RefundReasonError, setRefundReasonActive } from "@/server/refund-reasons";

/** `locationId` in the form means "this location's own account"; absent means the business's main account. */
async function locationFrom(businessId: string, formData: FormData) {
  const id = formData.get("locationId");
  if (typeof id !== "string" || !id) return null;
  return (await withTenant(businessId, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, id) }))) ?? null;
}

export async function connectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const location = await locationFrom(business.id, formData);
  const url = await startConnectOnboarding(business, slug, location);
  redirect(url);
}

export async function refreshStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const location = await locationFrom(business.id, formData);
  const accountId = location ? location.stripeAccountId : business.stripeAccountId;
  if (accountId) await syncConnectAccount(business.id, accountId);
  await setFlash("Stripe status refreshed");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function disconnectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const location = await locationFrom(business.id, formData);
  await disconnectConnectAccount(business.id, location?.id);
  await setFlash(location ? `${location.name} now uses the main Stripe account` : "Stripe account disconnected");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export const saveTax = formAction(z.object({ slug: z.string(), taxPct: f.num(0, 30) }), async (d) => {
  const { business } = await requireAction(d.slug, "business.manage");
  await db.update(schema.businesses).set({ taxRateBps: Math.round(d.taxPct * 100) }).where(eq(schema.businesses.id, business.id));
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Tax rate saved";
});

// ---------------------------------------------------------------------------
// Refund reasons
// ---------------------------------------------------------------------------
const reasonBase = z.object({ slug: z.string() });

export const addRefundReason = formAction(reasonBase.extend({ name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "business.manage");
  await createRefundReason(ctx.business.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Reason added";
});

export const renameRefundReasonAction = formAction(reasonBase.extend({ id: z.string().min(1), name: z.string().trim().min(1, "Enter a reason").max(60) }), async (d) => {
  const ctx = await requireAction(d.slug, "business.manage");
  await renameRefundReason(ctx.business.id, d.id, d.name);
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Reason renamed";
});

export async function setRefundReasonActiveAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "business.manage");
  try {
    await setRefundReasonActive(ctx.business.id, d.id, d.active === "1");
    await setFlash(d.active === "1" ? "Reason restored" : "Reason retired");
  } catch (e) {
    if (e instanceof RefundReasonError) await setFlash(e.message, "error");
    else throw e;
  }
  revalidatePath(`/app/${d.slug}/settings/payments`);
}

export async function moveRefundReasonAction(formData: FormData) {
  const d = reasonBase.extend({ id: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "business.manage");
  await moveRefundReason(ctx.business.id, d.id, d.dir);
  revalidatePath(`/app/${d.slug}/settings/payments`);
}
