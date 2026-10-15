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

export const saveReceiptFooter = formAction(z.object({ slug: z.string(), footer: z.string().max(400).optional() }), async (d) => {
  const { business } = await requireAction(d.slug, "business.manage");
  await db.update(schema.businesses).set({ receiptFooter: d.footer?.trim() || null }).where(eq(schema.businesses.id, business.id));
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Receipt footer saved";
});
