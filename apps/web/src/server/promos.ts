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
export async function validatePromo(tx: TenantDb, code: string, opts: { serviceIds: (string | null)[]; subtotalCents?: number; now?: Date; /** The ticket it is being applied to (its own hold doesn't count). */ forSaleId?: string }): Promise<PromoCode> {
  const c = code.trim().toUpperCase();
  if (!c) throw new PromoError("Enter a promo code.");
  // Locked, so two tickets or bookings can't both take the last use (the hold is saved later in the same transaction).
  const [p] = await tx.select().from(schema.promoCodes).where(and(eq(schema.promoCodes.code, c), eq(schema.promoCodes.active, true))).for("update");
  if (!p) throw new PromoError("That code isn't valid.");
  const now = opts.now ?? new Date();
  if (p.startsAt && p.startsAt > now) throw new PromoError("That code isn't active yet.");
  if (p.expiresAt && p.expiresAt < now) throw new PromoError("That code has expired.");
  if (p.maxUses != null && p.usesCount + (await heldUses(tx, p.id, opts.forSaleId)) >= p.maxUses) throw new PromoError("That code has been used up.");
  if (p.serviceIds.length && !opts.serviceIds.some((id) => id && p.serviceIds.includes(id))) throw new PromoError("That code doesn't apply to these services.");
  if (opts.subtotalCents != null && opts.subtotalCents < p.minSubtotalCents) throw new PromoError(`That code needs a subtotal of at least $${(p.minSubtotalCents / 100).toFixed(2)}.`);
  return p;
}

/**
 * Uses a code has that aren't counted yet: open tickets carrying it, and upcoming bookings carrying it that have no ticket yet (a ticket
 * opened from a booking takes over its hold). Paid tickets are in usesCount.
 */
async function heldUses(tx: TenantDb, promoId: string, exceptSaleId?: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    select (
      (select count(*) from sales s where s.promo_code_id = ${promoId} and s.status = 'open' ${exceptSaleId ? sql`and s.id <> ${exceptSaleId}` : sql``})
      + (select count(*) from appointments a where a.promo_code_id = ${promoId} and a.status in ('booked', 'confirmed', 'checked_in')
          and not exists (select 1 from sales s2 where s2.appointment_id = a.id and s2.status <> 'void'))
    )::int as n`);
  return Number(rows[0]?.n ?? 0);
}

/** Inside the transaction that saves a booking with a code: lock it and make sure a use is still free. */
export async function assertPromoRoom(tx: TenantDb, promoId: string) {
  const [p] = await tx.select().from(schema.promoCodes).where(eq(schema.promoCodes.id, promoId)).for("update");
  if (!p || !p.active) throw new PromoError("That code isn't valid.");
  if (p.maxUses != null && p.usesCount + (await heldUses(tx, p.id)) >= p.maxUses) throw new PromoError("That code has been used up.");
}

export function promoDiscount(p: PromoCode): Discount {
  return p.type === "percent" ? { type: "percent", value: p.value } : { type: "amount", value: p.value };
}

/** Count a use once the sale is paid (idempotent per sale via the sale's promo_code_id being cleared afterwards is unnecessary: closeIfPaid runs once). */
export async function countPromoUse(tx: TenantDb, promoCodeId: string) {
  await tx.update(schema.promoCodes).set({ usesCount: sql`${schema.promoCodes.usesCount} + 1` }).where(eq(schema.promoCodes.id, promoCodeId));
}
