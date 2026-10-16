"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { cadenceError, type MembershipInterval } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { issueGiftCardManually } from "@/server/offers";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { validAtFromForm } from "@/server/locations";
import { deleteFileByUrl, FileError, uploadedImageFrom } from "@/lib/files";

async function packageImage(businessId: string, raw: FormData) {
  try {
    return await uploadedImageFrom(businessId, "package", raw);
  } catch (e) {
    if (e instanceof FileError) throw new FormError(e.message, "image");
    throw e;
  }
}

export const createPackage = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), serviceId: z.string().optional().transform((v) => v || null), sessions: f.int(1, 100), price: f.money("price"), validDays: z.string().trim().optional(), description: f.optional(300) }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const validDays = d.validDays ? Number(d.validDays) : null;
    if (d.validDays && (!Number.isInteger(validDays) || validDays! < 1)) throw new FormError("Enter a whole number of days", "validDays");
    const imageUrl = await packageImage(ctx.business.id, raw);
    await withTenant(ctx.business.id, async (tx) => tx.insert(schema.packages).values({ businessId: ctx.business.id, name: d.name, serviceId: d.serviceId, sessions: d.sessions, priceCents: d.price, validDays, description: d.description, imageUrl, validLocationIds: await validAtFromForm(tx, raw) }));
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/packages`);
    redirect(`/app/${d.slug}/packages`);
  },
);

export const updatePackage = formAction(
  z.object({ slug: z.string(), id: z.string().min(1), name: f.text(1, 80), serviceId: z.string().optional().transform((v) => v || null), sessions: f.int(1, 100), price: f.money("price"), validDays: z.string().trim().optional(), description: f.optional(300) }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    const validDays = d.validDays ? Number(d.validDays) : null;
    if (d.validDays && (!Number.isInteger(validDays) || validDays! < 1)) throw new FormError("Enter a whole number of days", "validDays");
    const image = await packageImage(ctx.business.id, raw);
    const removeImage = raw.get("removeImage") === "on";
    await withTenant(ctx.business.id, async (tx) => {
      const current = await tx.query.packages.findFirst({ where: eq(schema.packages.id, d.id), columns: { imageUrl: true } });
      await tx.update(schema.packages).set({ name: d.name, serviceId: d.serviceId, sessions: d.sessions, priceCents: d.price, validDays, description: d.description, validLocationIds: await validAtFromForm(tx, raw), ...(image ? { imageUrl: image } : removeImage ? { imageUrl: null } : {}) }).where(eq(schema.packages.id, d.id));
      if ((image || removeImage) && current?.imageUrl) await deleteFileByUrl(current.imageUrl);
    });
    revalidatePath(`/app/${d.slug}/packages`);
    revalidatePath(`/app/${d.slug}/packages/${d.id}`);
    return "Package saved";
  },
);

export async function togglePackage(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), active: z.string() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "services.manage");
  await withTenant(ctx.business.id, (tx) => tx.update(schema.packages).set({ active: d.active === "true" }).where(eq(schema.packages.id, d.id)));
  await setFlash(d.active === "true" ? "Package shown again" : "Package hidden");
  revalidatePath(`/app/${d.slug}/packages`);
}

function cadenceOf(interval: string, count: number): { interval: MembershipInterval; count: number } {
  const err = cadenceError(interval, count);
  if (err) throw new FormError(err, "intervalCount");
  return { interval: interval as MembershipInterval, count };
}

export const createPlan = formAction(
  z.object({ slug: z.string(), name: f.text(1, 80), price: f.money("price"), interval: z.string(), intervalCount: f.int(1, 52), includedServiceId: z.string().optional(), includedSessions: f.int(0, 31), rolloverCap: f.int(0, 99), cycleCount: f.int(0, 120), discountPct: f.num(0, 100), description: f.optional(300) }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    if (d.includedSessions > 0 && !d.includedServiceId) throw new FormError("Choose which service the sessions are for", "includedServiceId");
    const cadence = cadenceOf(d.interval, d.intervalCount);
    await withTenant(ctx.business.id, async (tx) => tx.insert(schema.membershipPlans).values({ businessId: ctx.business.id, name: d.name, priceCents: d.price, interval: cadence.interval, intervalCount: cadence.count, includedServiceId: d.includedServiceId || null, includedSessions: d.includedSessions, rolloverCap: d.rolloverCap, cycleCount: d.cycleCount || null, discountBps: Math.round(d.discountPct * 100), description: d.description, validLocationIds: await validAtFromForm(tx, raw) }));
    await setFlash(`${d.name} added`);
    revalidatePath(`/app/${d.slug}/memberships`);
    redirect(`/app/${d.slug}/memberships`);
  },
);

export const updatePlan = formAction(
  z.object({ slug: z.string(), id: z.string().min(1), name: f.text(1, 80), price: f.money("price"), interval: z.string(), intervalCount: f.int(1, 52), includedServiceId: z.string().optional(), includedSessions: f.int(0, 31), rolloverCap: f.int(0, 99), cycleCount: f.int(0, 120), discountPct: f.num(0, 100), description: f.optional(300) }),
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "services.manage");
    if (d.includedSessions > 0 && !d.includedServiceId) throw new FormError("Choose which service the sessions are for", "includedServiceId");
    const cadence = cadenceOf(d.interval, d.intervalCount);
    await withTenant(ctx.business.id, async (tx) => {
      const before = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, d.id), columns: { priceCents: true, interval: true, intervalCount: true } });
      // A new price or cadence needs a new Stripe price; existing subscriptions keep the old one until set up again.
      const repriced = !!before && (before.priceCents !== d.price || before.interval !== cadence.interval || before.intervalCount !== cadence.count);
      await tx.update(schema.membershipPlans).set({ name: d.name, priceCents: d.price, interval: cadence.interval, intervalCount: cadence.count, includedServiceId: d.includedServiceId || null, includedSessions: d.includedSessions, rolloverCap: d.rolloverCap, cycleCount: d.cycleCount || null, discountBps: Math.round(d.discountPct * 100), description: d.description, validLocationIds: await validAtFromForm(tx, raw), ...(repriced ? { stripePriceId: null, stripePriceIds: {} } : {}) }).where(eq(schema.membershipPlans.id, d.id));
    });
    revalidatePath(`/app/${d.slug}/memberships`);
    revalidatePath(`/app/${d.slug}/memberships/${d.id}`);
    return "Plan saved";
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
  async (d, raw) => {
    // A card nobody paid for is free money: it has its own permission (selling one at checkout only needs checkout.take).
    const ctx = await requireAction(d.slug, "giftcards.issue");
    if (d.amount < 100) throw new FormError("Gift cards must be at least $1", "amount");
    const validLocationIds = await withTenant(ctx.business.id, (tx) => validAtFromForm(tx, raw));
    const card = await issueGiftCardManually({ businessId: ctx.business.id, amountCents: d.amount, recipientName: d.recipientName, actorUserId: ctx.user.id, validLocationIds });
    await setFlash(`Gift card ${card.code} issued`);
    revalidatePath(`/app/${d.slug}/gift-cards`);
    redirect(`/app/${d.slug}/gift-cards`);
  },
);
