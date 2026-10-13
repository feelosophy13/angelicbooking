import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { parseMoney } from "@angelic/core";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { timingFor } from "./availability";

/**
 * Stylist-specific prices and durations. A service has a base price and duration; a stylist may
 * have their own, stored as an override on the row that says they perform the service (blank =
 * the base). Booking, checkout and the open-time search all resolve through here so the price a
 * client is quoted, the length of the slot and what gets recorded agree.
 */

export class TermError extends Error {}

export type Override = { price: number | null; duration: number | null };
type Base = { priceCents: number; durationMin: number };

/** Every stylist's override for one service (stylists without a row are absent). */
export async function overridesForService(tx: TenantDb, serviceId: string): Promise<Map<string, Override>> {
  const rows = await tx.select({ staffId: schema.staffServices.staffId, price: schema.staffServices.priceCentsOverride, duration: schema.staffServices.durationMinOverride }).from(schema.staffServices).where(eq(schema.staffServices.serviceId, serviceId));
  return new Map(rows.map((r) => [r.staffId, { price: r.price, duration: r.duration }]));
}

/** One stylist's overrides across every service they perform (service id → override). */
export async function overridesForStaff(tx: TenantDb, staffId: string): Promise<Map<string, Override>> {
  const rows = await tx.select({ serviceId: schema.staffServices.serviceId, price: schema.staffServices.priceCentsOverride, duration: schema.staffServices.durationMinOverride }).from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId));
  return new Map(rows.map((r) => [r.serviceId, { price: r.price, duration: r.duration }]));
}

/** What this stylist charges and how long they take, falling back to the service's own. */
export function termsOf(service: Base, o?: Override | null) {
  const priceCents = o?.price ?? service.priceCents;
  const durationMin = o?.duration ?? service.durationMin;
  return { priceCents, durationMin, priceCustom: priceCents !== service.priceCents, durationCustom: durationMin !== service.durationMin };
}

/** The service's timing with one stylist's duration, for searching open times and re-checking a slot. */
export async function timingForStaff(businessId: string, service: Base & { gapMin: number; finishMin: number; bufferAfterMin: number; id: string }, staffId: string) {
  const o = (await withTenant(businessId, (tx) => overridesForService(tx, service.id))).get(staffId);
  return timingFor({ ...service, durationMin: o?.duration ?? service.durationMin });
}

/** The price a stylist would charge for a service right now. */
export async function priceForStaff(businessId: string, serviceId: string, staffId: string): Promise<number | null> {
  return withTenant(businessId, async (tx) => {
    const svc = await tx.query.services.findFirst({ where: eq(schema.services.id, serviceId), columns: { priceCents: true, durationMin: true } });
    if (!svc) return null;
    return termsOf(svc, (await overridesForService(tx, serviceId)).get(staffId)).priceCents;
  });
}

/**
 * Lowest and highest price a client could pay for each service, across the providers who can be
 * booked for it (a service nobody is assigned to can be done by any of `staff`).
 */
export async function servicePriceRanges(tx: TenantDb, services: { id: string; priceCents: number }[], staff: { id: string }[]): Promise<Map<string, { min: number; max: number }>> {
  const rows = await tx.select({ staffId: schema.staffServices.staffId, serviceId: schema.staffServices.serviceId, price: schema.staffServices.priceCentsOverride }).from(schema.staffServices);
  const byService = new Map<string, Map<string, number | null>>();
  for (const r of rows) byService.set(r.serviceId, (byService.get(r.serviceId) ?? new Map()).set(r.staffId, r.price));
  const out = new Map<string, { min: number; max: number }>();
  for (const s of services) {
    const mapped = byService.get(s.id);
    const providers = mapped?.size ? staff.filter((p) => mapped.has(p.id)) : staff;
    const prices = providers.length ? providers.map((p) => mapped?.get(p.id) ?? s.priceCents) : [s.priceCents];
    out.set(s.id, { min: Math.min(...prices), max: Math.max(...prices) });
  }
  return out;
}

/** "from $65.00" when providers charge different amounts, else the one price. */
export function priceLabel(range: { min: number; max: number }, fmt: (cents: number) => string): { label: string; varies: boolean } {
  return range.min === range.max ? { label: fmt(range.min), varies: false } : { label: fmt(range.min), varies: true };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** A posted price field: cents, null when blank (use the base), undefined when the field was not posted at all. */
export function parsePriceField(v: FormDataEntryValue | null | undefined): number | null | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return null;
  const cents = parseMoney(s);
  if (cents === null || cents < 0) throw new TermError("Enter a price like 45 or 45.50.");
  return cents;
}

/** A posted duration field in minutes, same convention as prices. */
export function parseMinutesField(v: FormDataEntryValue | null | undefined): number | null | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 5 || n > 600) throw new TermError("Enter a duration in whole minutes, from 5 to 600.");
  return n;
}

type Pick = { serviceId: string; price: number | null | undefined; duration: number | null | undefined };

/**
 * Set which services a stylist performs and their own price and duration for each. A value equal
 * to the service's base is stored as "use the base", so later changes to the base still flow
 * through. A field that was not posted keeps what is stored (an old form never erases prices).
 */
export async function applyStaffServices(tx: TenantDb, businessId: string, staffId: string, picks: Pick[]) {
  const ids = picks.map((p) => p.serviceId);
  const existing = new Map((await tx.select().from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId))).map((r) => [r.serviceId, r]));
  const base = ids.length ? new Map((await tx.select({ id: schema.services.id, price: schema.services.priceCents, duration: schema.services.durationMin }).from(schema.services).where(inArray(schema.services.id, ids))).map((s) => [s.id, s])) : new Map<string, { id: string; price: number; duration: number }>();
  await tx.delete(schema.staffServices).where(and(eq(schema.staffServices.staffId, staffId), ids.length ? notInArray(schema.staffServices.serviceId, ids) : undefined));
  if (!picks.length) return;
  const values = picks.map((p) => {
    const b = base.get(p.serviceId);
    const price = p.price === undefined ? (existing.get(p.serviceId)?.priceCentsOverride ?? null) : p.price;
    const duration = p.duration === undefined ? (existing.get(p.serviceId)?.durationMinOverride ?? null) : p.duration;
    return { businessId, staffId, serviceId: p.serviceId, priceCentsOverride: b && price === b.price ? null : price, durationMinOverride: b && duration === b.duration ? null : duration };
  });
  await tx
    .insert(schema.staffServices)
    .values(values)
    .onConflictDoUpdate({ target: [schema.staffServices.staffId, schema.staffServices.serviceId], set: { priceCentsOverride: sql`excluded.price_cents_override`, durationMinOverride: sql`excluded.duration_min_override` } });
}

/** From a service's own page: set the price and duration of stylists who already perform it. */
export async function applyServiceTerms(tx: TenantDb, serviceId: string, rows: { staffId: string; price: number | null | undefined; duration: number | null | undefined }[]) {
  const svc = await tx.query.services.findFirst({ where: eq(schema.services.id, serviceId), columns: { priceCents: true, durationMin: true } });
  if (!svc) return;
  for (const r of rows) {
    const set: { priceCentsOverride?: number | null; durationMinOverride?: number | null } = {};
    if (r.price !== undefined) set.priceCentsOverride = r.price === svc.priceCents ? null : r.price;
    if (r.duration !== undefined) set.durationMinOverride = r.duration === svc.durationMin ? null : r.duration;
    if (Object.keys(set).length) await tx.update(schema.staffServices).set(set).where(and(eq(schema.staffServices.staffId, r.staffId), eq(schema.staffServices.serviceId, serviceId)));
  }
}
