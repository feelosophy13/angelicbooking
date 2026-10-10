/**
 * Promo codes: percentage or fixed discounts with dates, usage limits and
 * optional service restrictions. Redeemed at checkout (becomes the sale's
 * discount) or typed at online booking (applied when checkout opens).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import type { Discount } from "@angelic/core";

export type PromoCode = typeof schema.promoCodes.$inferSelect;

export class PromoError extends Error {}

export async function listPromoCodes(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.promoCodes).orderBy(desc(schema.promoCodes.active), asc(schema.promoCodes.code)));
}

export function describePromo(p: PromoCode, currency = "usd"): string {
  return p.type === "percent" ? `${p.value}% off` : `${new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(p.value / 100)} off`;
}

/**
 * Find a usable code for the given services. `serviceIds` are the services
 * on the ticket (or the one being booked); `subtotalCents` is checked against
 * the minimum when known.
 */
export async function validatePromo(tx: TenantDb, code: string, opts: { serviceIds: (string | null)[]; subtotalCents?: number; now?: Date }): Promise<PromoCode> {
  const c = code.trim().toUpperCase();
  if (!c) throw new PromoError("Enter a promo code.");
  const p = await tx.query.promoCodes.findFirst({ where: and(eq(schema.promoCodes.code, c), eq(schema.promoCodes.active, true)) });
  if (!p) throw new PromoError("That code isn't valid.");
  const now = opts.now ?? new Date();
  if (p.startsAt && p.startsAt > now) throw new PromoError("That code isn't active yet.");
  if (p.expiresAt && p.expiresAt < now) throw new PromoError("That code has expired.");
  if (p.maxUses != null && p.usesCount >= p.maxUses) throw new PromoError("That code has been used up.");
  if (p.serviceIds.length && !opts.serviceIds.some((id) => id && p.serviceIds.includes(id))) throw new PromoError("That code doesn't apply to these services.");
  if (opts.subtotalCents != null && opts.subtotalCents < p.minSubtotalCents) throw new PromoError(`That code needs a subtotal of at least $${(p.minSubtotalCents / 100).toFixed(2)}.`);
  return p;
}

export function promoDiscount(p: PromoCode): Discount {
  return p.type === "percent" ? { type: "percent", value: p.value } : { type: "amount", value: p.value };
}

/** Count a use once the sale is paid (idempotent per sale via the sale's promo_code_id being cleared afterwards is unnecessary: closeIfPaid runs once). */
export async function countPromoUse(tx: TenantDb, promoCodeId: string) {
  await tx.update(schema.promoCodes).set({ usesCount: sql`${schema.promoCodes.usesCount} + 1` }).where(eq(schema.promoCodes.id, promoCodeId));
}
