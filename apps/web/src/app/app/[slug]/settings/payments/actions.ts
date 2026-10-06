"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { disconnectConnectAccount, startConnectOnboarding, syncConnectAccount } from "@/server/stripe-connect";

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
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function disconnectStripe(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  await disconnectConnectAccount(business.id);
  revalidatePath(`/app/${slug}/settings/payments`);
}

export async function saveTax(formData: FormData) {
  const slug = String(formData.get("slug"));
  const { business } = await requireAction(slug, "business.manage");
  const pct = z.coerce.number().min(0).max(30).parse(formData.get("taxPct"));
  await db.update(schema.businesses).set({ taxRateBps: Math.round(pct * 100) }).where(eq(schema.businesses.id, business.id));
  revalidatePath(`/app/${slug}/settings/payments`);
}
