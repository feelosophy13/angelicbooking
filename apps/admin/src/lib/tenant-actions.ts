import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@angelic/db";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";

export class ActionError extends Error {}

async function business(id: string) {
  const [b] = await adminDb().select({ id: schema.businesses.id, name: schema.businesses.name, suspendedAt: schema.businesses.suspendedAt, comped: schema.businesses.comped, trialEndsAt: schema.businesses.trialEndsAt, stripeSubscriptionId: schema.businesses.stripeSubscriptionId }).from(schema.businesses).where(eq(schema.businesses.id, id));
  if (!b) throw new ActionError("Business not found.");
  return b;
}

export async function suspendTenant(id: string, reason: string, actor: string): Promise<void> {
  await requireAdmin();
  const b = await business(id);
  if (b.suspendedAt) throw new ActionError("Already suspended.");
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.businesses).set({ suspendedAt: new Date(), suspendedReason: reason || null }).where(and(eq(schema.businesses.id, id), isNull(schema.businesses.suspendedAt)));
    await tx.insert(schema.adminAuditLog).values({ actor, action: "tenant.suspend", businessId: id, detail: { reason } });
  });
}

export async function reactivateTenant(id: string, actor: string): Promise<void> {
  await requireAdmin();
  const b = await business(id);
  if (!b.suspendedAt) throw new ActionError("Not suspended.");
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.businesses).set({ suspendedAt: null, suspendedReason: null }).where(eq(schema.businesses.id, id));
    await tx.insert(schema.adminAuditLog).values({ actor, action: "tenant.reactivate", businessId: id, detail: {} });
  });
}

export async function setComped(id: string, comped: boolean, actor: string): Promise<void> {
  await requireAdmin();
  const b = await business(id);
  if (b.comped === comped) return;
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.businesses).set({ comped }).where(eq(schema.businesses.id, id));
    await tx.insert(schema.adminAuditLog).values({ actor, action: comped ? "tenant.comp" : "tenant.uncomp", businessId: id, detail: {} });
  });
}

/** Push the trial end out by `days` from whichever is later, now or the current end. Businesses with a Stripe subscription change trials in Stripe. */
export async function extendTrial(id: string, days: number, actor: string): Promise<Date> {
  await requireAdmin();
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new ActionError("Enter a whole number of days from 1 to 365.");
  const b = await business(id);
  if (b.stripeSubscriptionId) throw new ActionError("This business has a Stripe subscription; change its trial in Stripe.");
  const from = b.trialEndsAt && b.trialEndsAt > new Date() ? b.trialEndsAt : new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
  await adminDb().transaction(async (tx) => {
    await tx.update(schema.businesses).set({ trialEndsAt: to }).where(eq(schema.businesses.id, id));
    await tx.insert(schema.adminAuditLog).values({ actor, action: "tenant.trial.extend", businessId: id, detail: { days, from: b.trialEndsAt, to } });
  });
  return to;
}
