"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { disconnectConnectAccount, startConnectOnboarding, syncConnectAccount } from "@/server/stripe-connect";
import { f, formAction } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export async function connectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const url = await startConnectOnboarding(business, slug);
  redirect(url);
}

export async function refreshStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  if (business.stripeAccountId) await syncConnectAccount(business.id, business.stripeAccountId);
  await setFlash("Stripe status refreshed");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function disconnectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  await disconnectConnectAccount(business.id);
  await setFlash("Stripe account disconnected");
  revalidatePath(`/app/${slug}/settings/payments`);
}

export const saveTax = formAction(z.object({ slug: z.string(), taxPct: f.num(0, 30) }), async (d) => {
  const { business } = await requireAction(d.slug, "business.manage");
  await db.update(schema.businesses).set({ taxRateBps: Math.round(d.taxPct * 100) }).where(eq(schema.businesses.id, business.id));
  revalidatePath(`/app/${d.slug}/settings/payments`);
  return "Tax rate saved";
});
