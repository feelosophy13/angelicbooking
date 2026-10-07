"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { issueGiftCardManually } from "@/server/offers";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";

export const createPackage = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), serviceId: f.id(), sessions: f.int(1, 100), price: f.money("price"), validDays: z.string().trim().optional() }),
  async (d) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const validDays = d.validDays ? Number(d.validDays) : null;
    if (d.validDays && (!Number.isInteger(validDays) || validDays! < 1)) throw new FormError("Enter a whole number of days", "validDays");
    await withTenant(ctx.business.id, (tx) => tx.insert(schema.packages).values({ businessId: ctx.business.id, name: d.name, serviceId: d.serviceId, sessions: d.sessions, priceCents: d.price, validDays }));
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/packages`);
    redirect(`/app/${d.slug}/packages`);
  },
);

export async function togglePackage(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.packages).set({ active: d.active === "true" }).where(eq(schema.packages.id, d.id)));
  await setFlash(d.active === "true" ? "Package shown again" : "Package hidden");
  revalidatePath(`/app/${d.slug}/packages`);
}

export const createPlan = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), price: f.money("monthly price"), includedServiceId: z.string().optional(), includedSessions: f.int(0, 31), discountPct: f.num(0, 100), description: f.optional(300) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "services.manage");
    if (d.includedSessions > 0 && !d.includedServiceId) throw new FormError("Choose which service the sessions are for", "includedServiceId");
    await withTenant(ctx.business.id, (tx) => tx.insert(schema.membershipPlans).values({ businessId: ctx.business.id, name: d.name, priceCents: d.price, includedServiceId: d.includedServiceId || null, includedSessions: d.includedSessions, discountBps: Math.round(d.discountPct * 100), description: d.description }));
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/memberships`);
    redirect(`/app/${d.slug}/memberships`);
  },
);

export async function togglePlan(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.membershipPlans).set({ active: d.active === "true" }).where(eq(schema.membershipPlans.id, d.id)));
  await setFlash(d.active === "true" ? "Plan shown again" : "Plan hidden");
  revalidatePath(`/app/${d.slug}/memberships`);
}

export const issueGiftCard = formAction(
  z.object({ slug: z.string(), amount: f.money("amount"), recipientName: f.optional(80) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "checkout.take");
    if (d.amount < 100) throw new FormError("Gift cards must be at least $1", "amount");
    const card = await issueGiftCardManually({ businessId: ctx.business.id, amountCents: d.amount, recipientName: d.recipientName, actorUserId: ctx.user.id });
    await setFlash(`Gift card ${card.code} issued`);
    revalidatePath(`/app/${d.slug}/gift-cards`);
    redirect(`/app/${d.slug}/gift-cards`);
  },
);
