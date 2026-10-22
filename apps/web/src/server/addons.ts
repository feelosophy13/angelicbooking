/**
 * Add-ons: services the salon suggests with another one at online booking ("Add to your visit?"). A pairing can price the add-on below
 * its usual price, either as a fixed price or as an amount off the stylist's own price, and can give it a shorter time (the client is
 * already in the chair). Blank means the usual terms. Booking the same service on its own always uses its usual terms.
 */
import { asc, eq } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

export const MAX_ADDONS = 3;

export type AddonPairing = typeof schema.serviceAddons.$inferSelect;

/** The add-on's price and time for a stylist whose usual terms for that service are `usual`. */
export function addonTerms(pairing: Pick<AddonPairing, "priceCents" | "discountCents" | "durationMin">, usual: { priceCents: number; durationMin: number }) {
  const priceCents = pairing.priceCents ?? Math.max(0, usual.priceCents - (pairing.discountCents ?? 0));
  return { priceCents, durationMin: pairing.durationMin ?? usual.durationMin, regularPriceCents: usual.priceCents, discounted: priceCents < usual.priceCents, shortened: pairing.durationMin != null };
}

export async function addonsForService(tx: TenantDb, serviceId: string): Promise<AddonPairing[]> {
  return tx.select().from(schema.serviceAddons).where(eq(schema.serviceAddons.serviceId, serviceId)).orderBy(asc(schema.serviceAddons.sortOrder));
}

export async function listAddons(businessId: string, serviceId: string) {
  return withTenant(businessId, (tx) => addonsForService(tx, serviceId));
}

export class AddonError extends Error {}

/** Replace a service's add-ons (at most MAX_ADDONS, none of them the service itself, each priced one way at most). */
export async function saveAddons(businessId: string, serviceId: string, rows: { addonServiceId: string; priceCents: number | null; discountCents: number | null; durationMin: number | null }[]) {
  const seen = new Set<string>();
  const clean = rows.filter((r) => r.addonServiceId && r.addonServiceId !== serviceId && !seen.has(r.addonServiceId) && seen.add(r.addonServiceId));
  if (clean.length > MAX_ADDONS) throw new AddonError(`Suggest at most ${MAX_ADDONS} add-ons: more than that and clients skip them all.`);
  for (const r of clean) {
    if (r.priceCents != null && r.discountCents != null) throw new AddonError("Give an add-on a fixed price or an amount off, not both.");
    if ((r.priceCents ?? 0) < 0 || (r.discountCents ?? 0) < 0) throw new AddonError("Prices can't be negative.");
    if (r.durationMin != null && (r.durationMin < 5 || r.durationMin > 480)) throw new AddonError("An add-on takes between 5 minutes and 8 hours.");
  }
  await withTenant(businessId, async (tx) => {
    const ids = await tx.select({ id: schema.services.id }).from(schema.services);
    const valid = new Set(ids.map((x) => x.id));
    if (!valid.has(serviceId) || clean.some((r) => !valid.has(r.addonServiceId))) throw new AddonError("One of those services no longer exists.");
    await tx.delete(schema.serviceAddons).where(eq(schema.serviceAddons.serviceId, serviceId));
    if (clean.length) await tx.insert(schema.serviceAddons).values(clean.map((r, i) => ({ businessId, serviceId, addonServiceId: r.addonServiceId, priceCents: r.priceCents, discountCents: r.discountCents, durationMin: r.durationMin, sortOrder: i })));
  });
}
