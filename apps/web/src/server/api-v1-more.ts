import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";

/** More API data access and serializers (allow-lists, like api-v1.ts). Same rule: business id from the key, inside withTenant, plus an explicit filter. */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const serializeLocation = (l: typeof schema.locations.$inferSelect) => ({
  id: l.id, name: l.name, address_line1: l.addressLine1, address_line2: l.addressLine2, city: l.city, state: l.state, postal_code: l.postalCode, country: l.country,
  timezone: l.timezone, phone: l.phone, hours: l.hours, is_default: l.isDefault,
});

export const serializePackage = (p: typeof schema.packages.$inferSelect) => ({
  id: p.id, name: p.name, service_id: p.serviceId, sessions: p.sessions, price_cents: p.priceCents, valid_days: p.validDays, description: p.description, active: p.active,
});
export const serializePlan = (p: typeof schema.membershipPlans.$inferSelect) => ({
  id: p.id, name: p.name, price_cents: p.priceCents, interval: p.interval, interval_count: p.intervalCount, included_service_id: p.includedServiceId,
  included_sessions: p.includedSessions, discount_bps: p.discountBps, description: p.description, active: p.active,
});

export const serializeReview = (r: typeof schema.reviews.$inferSelect) => ({
  id: r.id, rating: r.rating, comment: r.comment, client_id: r.clientId, appointment_id: r.appointmentId, staff_id: r.staffId, location_id: r.locationId, submitted_at: iso(r.submittedAt),
});

export const serializeWaitlist = (w: typeof schema.waitlist.$inferSelect) => ({
  id: w.id, client_id: w.clientId, service_id: w.serviceId, staff_id: w.staffId, location_id: w.locationId, date: w.date, notes: w.notes, status: w.status, created_at: iso(w.createdAt),
});

export const serializeNote = (n: typeof schema.clientNotes.$inferSelect) => ({ id: n.id, client_id: n.clientId, body: n.body, pinned: n.pinned, created_at: iso(n.createdAt) });

export const serializeMovement = (m: typeof schema.stockMovements.$inferSelect) => ({
  id: m.id, product_id: m.productId, delta: m.delta, reason: m.reason, location_id: m.locationId, sale_id: m.saleId, note: m.note, created_at: iso(m.createdAt),
});

/** Business-scoped single-table helpers. */
export const page = { limit: 50, offset: 0 };
type Pg = { limit: number; offset: number };

export const listLocationsApi = (b: string) => withTenant(b, (tx) => tx.select().from(schema.locations).where(eq(schema.locations.businessId, b)).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)));
export const listPackagesApi = (b: string, p: Pg) => withTenant(b, (tx) => tx.select().from(schema.packages).where(and(eq(schema.packages.businessId, b), eq(schema.packages.active, true))).orderBy(asc(schema.packages.name)).limit(p.limit).offset(p.offset));
export const listPlansApi = (b: string, p: Pg) => withTenant(b, (tx) => tx.select().from(schema.membershipPlans).where(and(eq(schema.membershipPlans.businessId, b), eq(schema.membershipPlans.active, true))).orderBy(asc(schema.membershipPlans.name)).limit(p.limit).offset(p.offset));

export async function listCategoriesApi(b: string, kind: "service" | "product") {
  return withTenant(b, async (tx) =>
    kind === "service"
      ? (await tx.select().from(schema.serviceCategories).where(eq(schema.serviceCategories.businessId, b)).orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name))).map((c) => ({ id: c.id, name: c.name, parent_id: c.parentId, description: c.description }))
      : (await tx.select().from(schema.productCategories).where(eq(schema.productCategories.businessId, b)).orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name))).map((c) => ({ id: c.id, name: c.name, parent_id: null, description: null })),
  );
}

export async function staffScheduleApi(b: string, staffId: string) {
  return withTenant(b, async (tx) => {
    const s = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, staffId), eq(schema.staff.businessId, b)), columns: { id: true, rotationWeeks: true, rotationAnchor: true } });
    if (!s) return null;
    const [weekly, overrides, services] = await Promise.all([
      tx.select().from(schema.staffSchedules).where(and(eq(schema.staffSchedules.staffId, staffId), eq(schema.staffSchedules.businessId, b))).orderBy(asc(schema.staffSchedules.weekIndex), asc(schema.staffSchedules.weekday), asc(schema.staffSchedules.startTime)),
      tx.select().from(schema.staffScheduleOverrides).where(and(eq(schema.staffScheduleOverrides.staffId, staffId), eq(schema.staffScheduleOverrides.businessId, b), sql`${schema.staffScheduleOverrides.date} >= current_date - 1`)).orderBy(asc(schema.staffScheduleOverrides.date)),
      tx.select().from(schema.staffServices).where(and(eq(schema.staffServices.staffId, staffId), eq(schema.staffServices.businessId, b))),
    ]);
    return {
      rotation_weeks: s.rotationWeeks,
      rotation_anchor: s.rotationAnchor,
      weekly: weekly.map((w) => ({ weekday: w.weekday, week_index: w.weekIndex, start: String(w.startTime).slice(0, 5), end: String(w.endTime).slice(0, 5), location_id: w.locationId })),
      overrides: overrides.map((o) => ({ date: o.date, is_off: o.isOff, start: o.startTime ? String(o.startTime).slice(0, 5) : null, end: o.endTime ? String(o.endTime).slice(0, 5) : null, note: o.note })),
      services: services.map((x) => ({ service_id: x.serviceId, price_cents: x.priceCentsOverride, duration_min: x.durationMinOverride })),
    };
  });
}

export const listReviewsApi = (b: string, p: Pg, f: { rating?: number; staffId?: string }) =>
  withTenant(b, (tx) =>
    tx.select().from(schema.reviews).where(and(eq(schema.reviews.businessId, b), isNotNull(schema.reviews.submittedAt), ...(f.rating ? [eq(schema.reviews.rating, f.rating)] : []), ...(f.staffId ? [eq(schema.reviews.staffId, f.staffId)] : []))).orderBy(desc(schema.reviews.submittedAt)).limit(p.limit).offset(p.offset),
  );

export const listWaitlistApi = (b: string, p: Pg, status?: string) =>
  withTenant(b, (tx) => tx.select().from(schema.waitlist).where(and(eq(schema.waitlist.businessId, b), ...(status ? [sql`${schema.waitlist.status} = ${status}`] : []))).orderBy(asc(schema.waitlist.date), asc(schema.waitlist.createdAt)).limit(p.limit).offset(p.offset));

export async function clientExists(b: string, id: string) {
  return !!(await withTenant(b, (tx) => tx.query.clients.findFirst({ where: and(eq(schema.clients.id, id), eq(schema.clients.businessId, b)), columns: { id: true } })));
}

export const listNotesApi = (b: string, clientId: string, p: Pg) =>
  withTenant(b, (tx) => tx.select().from(schema.clientNotes).where(and(eq(schema.clientNotes.clientId, clientId), eq(schema.clientNotes.businessId, b))).orderBy(desc(schema.clientNotes.pinned), desc(schema.clientNotes.createdAt)).limit(p.limit).offset(p.offset));

export async function clientHoldingsApi(b: string, clientId: string) {
  return withTenant(b, async (tx) => {
    const [pk, ms] = await Promise.all([
      tx.select({ c: schema.clientPackages, name: schema.packages.name }).from(schema.clientPackages).innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId)).where(and(eq(schema.clientPackages.clientId, clientId), eq(schema.clientPackages.businessId, b))),
      tx.select({ m: schema.clientMemberships, name: schema.membershipPlans.name }).from(schema.clientMemberships).innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId)).where(and(eq(schema.clientMemberships.clientId, clientId), eq(schema.clientMemberships.businessId, b))),
    ]);
    return {
      packages: pk.map(({ c, name }) => ({ id: c.id, package_id: c.packageId, name, service_id: c.serviceId, sessions_remaining: c.remaining, expires_at: iso(c.expiresAt), created_at: iso(c.createdAt) })),
      memberships: ms.map(({ m, name }) => ({ id: m.id, plan_id: m.planId, name, status: m.status, started_at: iso(m.startedAt), current_period_end: iso(m.currentPeriodEnd), credits_remaining: m.creditsRemaining, auto_renew: m.autoRenew, frozen_until: iso(m.frozenUntil), cancelled_at: iso(m.cancelledAt) })),
    };
  });
}

// ---- Catalog writes ----
const money = z.number().int().min(0).max(10_000_000);
// Like the client schemas: no `.default()`, so a PATCH never resets what it did not mention. Create applies the defaults below.
export const servicePatch = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable(),
  prep_notes: z.string().trim().max(400).nullable(),
  category_id: z.string().max(100).nullable(),
  duration_min: z.number().int().min(5).max(600),
  gap_min: z.number().int().min(0).max(600),
  finish_min: z.number().int().min(0).max(600),
  buffer_after_min: z.number().int().min(0).max(120),
  price_cents: money,
  deposit_type: z.enum(["flat", "percent", "full"]),
  deposit_cents: money,
  deposit_percent: z.number().int().min(0).max(100),
  capacity: z.number().int().min(1).max(500),
  bookable_online: z.boolean(),
  active: z.boolean(),
  location_ids: z.array(z.string().max(100)).max(100),
}).partial().strict();
export const serviceCreate = servicePatch.required({ name: true, duration_min: true, price_cents: true });
export const SERVICE_DEFAULTS = { gap_min: 0, finish_min: 0, buffer_after_min: 0, deposit_type: "flat", deposit_cents: 0, deposit_percent: 0, capacity: 1, bookable_online: true, active: true } as const;

export const productPatch = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable(),
  kind: z.enum(["retail", "backbar"]),
  category_id: z.string().max(100).nullable(),
  sku: z.string().trim().max(60).nullable(),
  barcode: z.string().trim().max(60).nullable(),
  price_cents: money,
  cost_cents: money,
  taxable: z.boolean(),
  sell_online: z.boolean(),
  track_stock: z.boolean(),
  low_stock_threshold: z.number().int().min(0).max(100_000),
  active: z.boolean(),
}).partial().strict();
export const productCreate = productPatch.required({ name: true, price_cents: true });
export const PRODUCT_DEFAULTS = { kind: "retail", cost_cents: 0, taxable: true, sell_online: false, track_stock: false, low_stock_threshold: 3, active: true } as const;

export const noteInput = z.object({ body: z.string().trim().min(1).max(5000), pinned: z.boolean().default(false) });
export const waitlistInput = z.object({
  client_id: z.string().min(1).max(100),
  service_id: z.string().min(1).max(100),
  staff_id: z.string().max(100).nullish(),
  location_id: z.string().max(100).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).nullish(),
});
