/**
 * Locations are the money boundary inside a tenant: each may run on its own
 * Stripe Connect account (else the business's main account), carry its own
 * sales-tax rate and appear as the merchant on receipts. Everything else
 * (clients, services, gift cards, packages, memberships) is shared.
 */
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, withJobs, withTenant, type TenantDb } from "@angelic/db";
import { isStripeConfigured } from "@/lib/stripe";

type Business = typeof schema.businesses.$inferSelect;
export type Location = typeof schema.locations.$inferSelect;

export interface PaymentContext {
  location: Location | null;
  /** Connected account that takes this location's money: its own, else the business's main account. */
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  /** True when the location runs on the business's main Stripe account. */
  usesMainAccount: boolean;
  taxRateBps: number;
  /** Receipt identity (merchant name, address, phone). */
  name: string;
  addressLine: string | null;
  phone: string | null;
  /** Platform keys present, account connected and charges enabled. */
  ready: boolean;
}

export function addressOf(l: Pick<Location, "addressLine1" | "addressLine2" | "city" | "state" | "postalCode"> | null | undefined): string | null {
  if (!l) return null;
  const street = [l.addressLine1, l.addressLine2].filter(Boolean).join(" ");
  const cityLine = [l.city, [l.state, l.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, cityLine].filter(Boolean).join(", ") || null;
}

/** The postal address a marketing email must show (CAN-SPAM): the business's own, else its main location's. Null when there is none. */
export async function postalAddress(tx: TenantDb, business: Pick<Business, "addressLine">): Promise<string | null> {
  if (business.addressLine?.trim()) return business.addressLine.trim();
  const locs = await tx.select().from(schema.locations).orderBy(desc(schema.locations.isDefault));
  for (const l of locs) {
    const a = addressOf(l);
    if (a) return a;
  }
  return null;
}

/** Time zone per location id (quiet hours follow the site the client uses; the business's own zone when unknown). */
export async function locationTimeZones(tx: TenantDb, business: Pick<Business, "timezone">): Promise<(locationId: string | null | undefined) => string> {
  const locs = await tx.select().from(schema.locations);
  const byId = new Map(locs.map((l) => [l.id, tzFor(business, l)]));
  return (id) => (id && byId.get(id)) || business.timezone;
}

export const NO_POSTAL_ADDRESS = "Marketing emails must show your business's postal address. Add it under Settings → Locations (or Business), then send again.";

/** Pure: the payment settings in force for a (possibly null) location. */
export function paymentContext(business: Business, location: Location | null | undefined): PaymentContext {
  const own = !!location?.stripeAccountId;
  const accountId = own ? location!.stripeAccountId : business.stripeAccountId;
  const chargesEnabled = own ? location!.stripeChargesEnabled : business.stripeChargesEnabled;
  const detailsSubmitted = own ? location!.stripeDetailsSubmitted : business.stripeDetailsSubmitted;
  return {
    location: location ?? null,
    accountId,
    chargesEnabled,
    detailsSubmitted,
    usesMainAccount: !own,
    taxRateBps: location?.taxRateBps ?? business.taxRateBps,
    // A location on its own Stripe account is its own merchant; otherwise the business is.
    name: own ? location!.name : business.name,
    addressLine: own ? (addressOf(location) ?? business.addressLine) : (business.addressLine ?? addressOf(location)),
    phone: own ? (location!.phone ?? business.phone) : (business.phone ?? location?.phone ?? null),
    ready: isStripeConfigured() && !!accountId && chargesEnabled,
  };
}

/** Wall-clock zone for scheduling at a location (its own, else the business's). */
export function tzFor(business: Pick<Business, "timezone">, location: Pick<Location, "timezone"> | null | undefined): string {
  return location?.timezone ?? business.timezone;
}

export async function listLocations(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.isDefault), asc(schema.locations.name)));
}

export async function defaultLocation(tx: TenantDb): Promise<Location | null> {
  return (await tx.query.locations.findFirst({ where: eq(schema.locations.isDefault, true) })) ?? (await tx.query.locations.findFirst()) ?? null;
}

/** The location by id, else the default one (so callers always get the business's "main" site). */
export async function locationOrDefault(tx: TenantDb, locationId: string | null | undefined): Promise<Location | null> {
  if (locationId) {
    const l = await tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) });
    if (l) return l;
  }
  return defaultLocation(tx);
}

export async function paymentContextFor(business: Business, locationId: string | null | undefined): Promise<PaymentContext> {
  const location = await withTenant(business.id, (tx) => locationOrDefault(tx, locationId));
  return paymentContext(business, location);
}

export async function paymentContextForSale(business: Business, saleId: string): Promise<PaymentContext> {
  const location = await withTenant(business.id, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId), columns: { locationId: true } });
    return locationOrDefault(tx, sale?.locationId);
  });
  return paymentContext(business, location);
}

export async function paymentContextForAppointment(business: Business, appointmentId: string): Promise<PaymentContext> {
  const location = await withTenant(business.id, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { locationId: true } });
    return locationOrDefault(tx, appt?.locationId);
  });
  return paymentContext(business, location);
}

/** Every distinct payment context of a business (main account + locations with their own). Used by Settings → Payments. */
export function paymentContextsOf(business: Business, locations: Location[]): PaymentContext[] {
  return locations.map((l) => paymentContext(business, l));
}

/** One context per distinct Stripe account that is ready to charge: the main account once, plus each location with its own. */
export async function readyAccountsOf(business: Business): Promise<PaymentContext[]> {
  const locations = await listLocations(business.id);
  const out = new Map<string, PaymentContext>();
  for (const l of [...locations].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))) {
    const p = paymentContext(business, l);
    if (p.ready && p.accountId && !out.has(p.accountId)) out.set(p.accountId, p);
  }
  if (!locations.length) {
    const p = paymentContext(business, null);
    if (p.ready && p.accountId) out.set(p.accountId, p);
  }
  return [...out.values()];
}

/**
 * Webhook helper: which tenant (and location) a connected account belongs to.
 * Runs without tenant context, so locations are read with the jobs policy.
 */
export async function tenantForAccount(accountId: string): Promise<{ businessId: string; locationId: string | null } | null> {
  const loc = await withJobs((tx) => tx.query.locations.findFirst({ where: eq(schema.locations.stripeAccountId, accountId), columns: { id: true, businessId: true } }));
  if (loc) return { businessId: loc.businessId, locationId: loc.id };
  return null;
}

// ---------------------------------------------------------------------------
// Staff ↔ locations (per weekday, from staff_schedules)
// ---------------------------------------------------------------------------

/** Effective location of a weekly-hours row: its own, else the staff member's primary, else the default. */
export function effectiveLocationId(row: { locationId: string | null }, staffPrimary: string | null | undefined, defaultId: string | null): string | null {
  return row.locationId ?? staffPrimary ?? defaultId;
}

export interface StaffLocationIndex {
  /** staffId → weekday → effective locations (more than one only when rotation weeks differ). */
  byDay: Map<string, Map<number, Set<string | null>>>;
  /** staffId → set of locations they work at on any day. */
  any: Map<string, Set<string>>;
  /** Staff with no weekly hours at all (new hires). */
  noHours: Set<string>;
  defaultId: string | null;
}

/** Build the per-weekday location index for all (or some) staff. */
export async function staffLocationIndex(tx: TenantDb, staffIds?: string[]): Promise<StaffLocationIndex> {
  const [rows, people, def] = await Promise.all([
    tx
      .select({ staffId: schema.staffSchedules.staffId, weekday: schema.staffSchedules.weekday, locationId: schema.staffSchedules.locationId })
      .from(schema.staffSchedules)
      .where(staffIds ? inArray(schema.staffSchedules.staffId, staffIds.length ? staffIds : ["-"]) : undefined),
    tx.select({ id: schema.staff.id, locationId: schema.staff.locationId }).from(schema.staff).where(staffIds ? inArray(schema.staff.id, staffIds.length ? staffIds : ["-"]) : undefined),
    defaultLocation(tx),
  ]);
  const primary = new Map(people.map((p) => [p.id, p.locationId]));
  const byDay = new Map<string, Map<number, Set<string | null>>>();
  const any = new Map<string, Set<string>>();
  for (const r of rows) {
    const loc = effectiveLocationId(r, primary.get(r.staffId), def?.id ?? null);
    if (!byDay.has(r.staffId)) byDay.set(r.staffId, new Map());
    const day = byDay.get(r.staffId)!;
    if (!day.has(r.weekday)) day.set(r.weekday, new Set());
    day.get(r.weekday)!.add(loc);
    if (loc) {
      if (!any.has(r.staffId)) any.set(r.staffId, new Set());
      any.get(r.staffId)!.add(loc);
    }
  }
  const noHours = new Set(people.filter((p) => !byDay.has(p.id)).map((p) => p.id));
  // Staff without hours count as being at their primary (or default) location so they still appear in pickers.
  for (const id of noHours) {
    const loc = primary.get(id) ?? def?.id ?? null;
    if (loc) any.set(id, new Set([loc]));
  }
  return { byDay, any, noHours, defaultId: def?.id ?? null };
}

/** Is this staff member at `locationId` on `weekday`? (Everyone qualifies when no location is given.) */
export function worksAt(index: StaffLocationIndex, staffId: string, weekday: number, locationId: string | null): boolean {
  if (!locationId) return true;
  const day = index.byDay.get(staffId);
  if (!day) return index.any.get(staffId)?.has(locationId) ?? false;
  return day.get(weekday)?.has(locationId) ?? false;
}

// ---------------------------------------------------------------------------
// Services offered at a location
// ---------------------------------------------------------------------------

/** Service ids NOT offered at `locationId` (services with no rows are offered everywhere). */
export async function servicesHiddenAt(tx: TenantDb, locationId: string | null | undefined): Promise<Set<string>> {
  if (!locationId) return new Set();
  const rows = await tx.select({ serviceId: schema.serviceLocations.serviceId, locationId: schema.serviceLocations.locationId }).from(schema.serviceLocations);
  const restricted = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!restricted.has(r.serviceId)) restricted.set(r.serviceId, new Set());
    restricted.get(r.serviceId)!.add(r.locationId);
  }
  return new Set([...restricted.entries()].filter(([, locs]) => !locs.has(locationId)).map(([id]) => id));
}

export async function serviceOfferedAt(tx: TenantDb, serviceId: string, locationId: string | null | undefined): Promise<boolean> {
  if (!locationId) return true;
  const rows = await tx.select({ locationId: schema.serviceLocations.locationId }).from(schema.serviceLocations).where(eq(schema.serviceLocations.serviceId, serviceId));
  return rows.length === 0 || rows.some((r) => r.locationId === locationId);
}

/** Location ids ticked on a form (loc_<id> boxes); [] when none/all ticked or the boxes weren't shown. */
export async function validAtFromForm(tx: TenantDb, raw: FormData): Promise<string[]> {
  if (!raw.has("hasLocations")) return [];
  const all = await tx.select({ id: schema.locations.id }).from(schema.locations);
  const picked = [...raw.keys()].filter((k) => k.startsWith("loc_")).map((k) => k.slice(4)).filter((id) => all.some((l) => l.id === id));
  return picked.length === 0 || picked.length >= all.length ? [] : picked;
}

/** Can something valid at `validAt` (empty = anywhere) be used at `locationId`? */
export function validAtLocation(validAt: string[] | null | undefined, locationId: string | null | undefined): boolean {
  return !validAt?.length || (!!locationId && validAt.includes(locationId));
}

/** Replace a service's "offered at" set. An empty set, or every location, means everywhere. */
export async function setServiceLocations(tx: TenantDb, businessId: string, serviceId: string, locationIds: string[]) {
  const all = await tx.select({ id: schema.locations.id }).from(schema.locations);
  const chosen = new Set(locationIds.filter((id) => all.some((l) => l.id === id)));
  await tx.delete(schema.serviceLocations).where(eq(schema.serviceLocations.serviceId, serviceId));
  if (chosen.size === 0 || chosen.size === all.length) return;
  await tx.insert(schema.serviceLocations).values([...chosen].map((locationId) => ({ businessId, serviceId, locationId })));
}

// ---------------------------------------------------------------------------
// Client home location
// ---------------------------------------------------------------------------

/** Re-derive a client's home location: the location of their most recent non-cancelled appointment. */
export async function refreshHomeLocation(tx: TenantDb, clientId: string | null | undefined) {
  if (!clientId) return;
  await tx.execute(sql`
    update clients c set home_location_id = (
      select a.location_id from appointments a
      join appointment_items ai on ai.appointment_id = a.id and ai.sort_order = 0
      where a.client_id = c.id and a.location_id is not null and a.status not in ('cancelled','no_show')
      order by ai.start_at desc limit 1)
    where c.id = ${clientId}`);
}

/** Staff visible for a location in pickers: works there on some day, or (no hours yet) primary/default there. */
export async function staffIdsAt(tx: TenantDb, locationId: string | null | undefined): Promise<Set<string> | null> {
  if (!locationId) return null;
  const idx = await staffLocationIndex(tx);
  return new Set([...idx.any.entries()].filter(([, locs]) => locs.has(locationId)).map(([id]) => id));
}
