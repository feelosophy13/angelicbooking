"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { issueGiftCardManually } from "@/server/offers";

export async function createPackage(formData: FormData) {
  const d = z.object({ slug: z.string(), name: z.string().trim().min(1).max(80), serviceId: z.string().min(1), sessions: z.coerce.number().int().min(1).max(100), price: z.string(), validDays: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  const priceCents = parseMoney(d.price);
  if (priceCents === null) throw new Error("Enter a price");
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.packages).values({ businessId: ctx.business.id, name: d.name, serviceId: d.serviceId, sessions: d.sessions, priceCents, validDays: d.validDays ? Number(d.validDays) || null : null }));
  revalidatePath(`/app/${d.slug}/offers`);
}

export async function togglePackage(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.packages).set({ active: d.active === "true" }).where(eq(schema.packages.id, d.id)));
  revalidatePath(`/app/${d.slug}/offers`);
}

export async function createPlan(formData: FormData) {
  const d = z.object({ slug: z.string(), name: z.string().trim().min(1).max(80), price: z.string(), includedServiceId: z.string().optional(), includedSessions: z.coerce.number().int().min(0).max(31).default(0), discountPct: z.coerce.number().min(0).max(100).default(0), description: z.string().trim().max(300).optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  const priceCents = parseMoney(d.price);
  if (priceCents === null) throw new Error("Enter a monthly price");
  await withTenant(ctx.business.id, (tx) => tx.insert(schema.membershipPlans).values({ businessId: ctx.business.id, name: d.name, priceCents, includedServiceId: d.includedServiceId || null, includedSessions: d.includedSessions, discountBps: Math.round(d.discountPct * 100), description: d.description || null }));
  revalidatePath(`/app/${d.slug}/offers`);
}

export async function togglePlan(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.membershipPlans).set({ active: d.active === "true" }).where(eq(schema.membershipPlans.id, d.id)));
  revalidatePath(`/app/${d.slug}/offers`);
}

export async function issueGiftCard(formData: FormData) {
  const d = z.object({ slug: z.string(), amount: z.string(), recipientName: z.string().trim().max(80).optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  const cents = parseMoney(d.amount);
  if (cents === null || cents < 100) throw new Error("Enter an amount of at least $1");
  await issueGiftCardManually({ businessId: ctx.business.id, amountCents: cents, recipientName: d.recipientName || null, actorUserId: ctx.user.id });
  revalidatePath(`/app/${d.slug}/offers`);
}
