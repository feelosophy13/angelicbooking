import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { CARD_FEE_METHODS, splitTips, tipsPerPayment } from "@angelic/core";

/**
 * Data access for the public REST API. Every function takes the business id from the authenticated key and runs inside withTenant, so row-level
 * security confines it to that business; where a query is addressed by id it also filters on business_id explicitly (belt and braces).
 *
 * The serializers are allow-lists: a column reaches the API only if it is named here. Pay rates, PINs, calendar and manage tokens, Stripe ids and
 * login links are never listed.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const serializeBusiness = (b: typeof schema.businesses.$inferSelect) => ({
  id: b.id, name: b.name, slug: b.slug, timezone: b.timezone, phone: b.phone, email: b.email, slot_interval_min: b.slotIntervalMin,
});

type ServiceRow = typeof schema.services.$inferSelect;
export const serializeService = (s: ServiceRow) => ({
  id: s.id, name: s.name, description: s.description, category_id: s.categoryId, duration_min: s.durationMin, price_cents: s.priceCents,
  deposit_cents: s.depositCents, deposit_type: s.depositType, deposit_percent: s.depositPercent, capacity: s.capacity, bookable_online: s.bookableOnline, active: s.active,
});

type StaffRow = typeof schema.staff.$inferSelect;
export const serializeStaff = (s: StaffRow) => ({
  id: s.id, display_name: s.displayName, position: s.position, bio: s.bio, photo_url: s.photoUrl, location_id: s.locationId,
  bookable_online: s.bookableOnline, takes_appointments: s.takesAppointments, active: s.active,
});

type ClientRow = typeof schema.clients.$inferSelect;
/** `notes` are private (client-notes:read) and `store_credit_cents` is a balance (clients:balances): left out unless the key holds that scope. */
export const serializeClient = (c: ClientRow, scopes: readonly string[]) => ({
  id: c.id, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, tags: c.tags, birthday: c.birthday,
  ...(scopes.includes("client-notes:read") ? { notes: c.notes } : {}),
  sms_opt_in: c.smsOptIn, email_opt_in: c.emailOptIn,
  ...(scopes.includes("clients:balances") ? { store_credit_cents: c.storeCreditCents } : {}),
  created_at: iso(c.createdAt), updated_at: iso(c.updatedAt),
});

type ProductRow = typeof schema.products.$inferSelect;
export const serializeProduct = (p: ProductRow) => ({
  id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, variant_label: p.variantLabel, kind: p.kind, price_cents: p.priceCents, taxable: p.taxable,
  active: p.active, description: p.description, image_url: p.imageUrl, track_stock: p.trackStock, stock_qty: p.trackStock ? p.stockQty : null, low_stock_threshold: p.lowStockThreshold, category_id: p.categoryId, sell_online: p.sellOnline,
});

export async function listServices(businessId: string, opts: { activeOnly: boolean; limit: number; offset: number }) {
  return withTenant(businessId, (tx) =>
    tx.select().from(schema.services).where(and(eq(schema.services.businessId, businessId), ...(opts.activeOnly ? [eq(schema.services.active, true)] : []))).orderBy(asc(schema.services.sortOrder), asc(schema.services.name)).limit(opts.limit).offset(opts.offset),
  );
}
export async function getService(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, id), eq(schema.services.businessId, businessId)) }));
}

export async function listStaff(businessId: string, opts: { limit: number; offset: number }) {
  return withTenant(businessId, (tx) => tx.select().from(schema.staff).where(and(eq(schema.staff.businessId, businessId), eq(schema.staff.active, true))).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)).limit(opts.limit).offset(opts.offset));
}
export async function getStaff(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.businessId, businessId)) }));
}

export async function listProducts(businessId: string, opts: { limit: number; offset: number }) {
  return withTenant(businessId, (tx) => tx.select().from(schema.products).where(and(eq(schema.products.businessId, businessId), eq(schema.products.active, true))).orderBy(asc(schema.products.name)).limit(opts.limit).offset(opts.offset));
}

// ---- Clients ----
export async function listClientsApi(businessId: string, opts: { q?: string; email?: string; phone?: string; updatedSince?: Date | null; limit: number; offset: number }) {
  const { clientSearchWhere } = await import("./clients");
  return withTenant(businessId, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(schema.clients.businessId, businessId)];
    if (opts.q?.trim()) conds.push(clientSearchWhere(opts.q.trim()));
    if (opts.email) conds.push(sql`lower(${schema.clients.email}) = ${opts.email.toLowerCase()}`);
    if (opts.phone) conds.push(eq(schema.clients.phone, opts.phone));
    if (opts.updatedSince) conds.push(gte(schema.clients.updatedAt, opts.updatedSince));
    const where = and(...conds);
    const [rows, [n]] = await Promise.all([
      tx.select().from(schema.clients).where(where).orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName), asc(schema.clients.id)).limit(opts.limit).offset(opts.offset),
      tx.select({ n: sql<number>`count(*)` }).from(schema.clients).where(where),
    ]);
    return { rows, total: Number(n?.n ?? 0) };
  });
}
export async function getClientApi(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.clients.findFirst({ where: and(eq(schema.clients.id, id), eq(schema.clients.businessId, businessId)) }));
}

// ---- Appointments ----
export const serializeAppointment = (a: typeof schema.appointments.$inferSelect, items: (typeof schema.appointmentItems.$inferSelect)[]) => ({
  id: a.id, status: a.status, source: a.source, kind: a.kind, client_id: a.clientId, location_id: a.locationId, notes: a.notes,
  start_at: iso(items.length ? new Date(Math.min(...items.map((i) => i.startAt.getTime()))) : null),
  end_at: iso(items.length ? new Date(Math.max(...items.map((i) => i.endAt.getTime()))) : null),
  deposit_cents: a.depositCents, cancelled_at: iso(a.cancelledAt), cancellation_reason: a.cancellationReason,
  items: items.sort((x, y) => x.sortOrder - y.sortOrder).map((i) => ({ id: i.id, service_id: i.serviceId, service_name: i.serviceName, staff_id: i.staffId, start_at: iso(i.startAt), end_at: iso(i.endAt), price_cents: i.priceCents, status: i.status })),
  created_at: iso(a.createdAt),
});

export async function getAppointmentApi(businessId: string, id: string) {
  return withTenant(businessId, async (tx) => {
    const a = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, businessId)) });
    if (!a) return null;
    const items = await tx.select().from(schema.appointmentItems).where(and(eq(schema.appointmentItems.appointmentId, a.id), eq(schema.appointmentItems.businessId, businessId)));
    return serializeAppointment(a, items);
  });
}

export async function listAppointmentsApi(businessId: string, opts: { from?: Date; to?: Date; status?: string; clientId?: string; staffId?: string; limit: number; offset: number }) {
  return withTenant(businessId, async (tx) => {
    const t = schema.appointmentItems;
    const conds: (SQL | undefined)[] = [eq(schema.appointments.businessId, businessId), eq(schema.appointments.kind, "visit")];
    if (opts.status) conds.push(sql`${schema.appointments.status} = ${opts.status}`);
    if (opts.clientId) conds.push(eq(schema.appointments.clientId, opts.clientId));
    // An appointment is in range when its first item starts in [from, to).
    const first = sql`(select min(start_at) from appointment_items ai where ai.appointment_id = ${schema.appointments.id})`;
    if (opts.from) conds.push(sql`${first} >= ${opts.from.toISOString()}::timestamptz`);
    if (opts.to) conds.push(sql`${first} < ${opts.to.toISOString()}::timestamptz`);
    if (opts.staffId) conds.push(sql`exists (select 1 from appointment_items ai where ai.appointment_id = ${schema.appointments.id} and ai.staff_id = ${opts.staffId})`);
    const where = and(...conds);
    const [appts, [n]] = await Promise.all([
      tx.select().from(schema.appointments).where(where).orderBy(asc(first), asc(schema.appointments.id)).limit(opts.limit).offset(opts.offset),
      tx.select({ n: sql<number>`count(*)` }).from(schema.appointments).where(where),
    ]);
    const ids = appts.map((a) => a.id);
    const items = ids.length ? await tx.select().from(t).where(and(eq(t.businessId, businessId), sql`${t.appointmentId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) : [];
    return { rows: appts.map((a) => serializeAppointment(a, items.filter((i) => i.appointmentId === a.id))), total: Number(n?.n ?? 0) };
  });
}

// ---- Sales (read only) ----
export const serializeSale = (s: typeof schema.sales.$inferSelect, lines?: (typeof schema.saleLines.$inferSelect)[], pays?: (typeof schema.payments.$inferSelect)[]) => {
  // With the lines and payments both present, tips are described by how they were handed over: the sale's cash and card totals, and each payment's real share
  // (a tip marked cash lands on the non-card payments, one marked card on the card payments, an unmarked one across all by amount).
  const tipParts = (lines ?? []).filter((l) => l.kind === "tip").map((l) => ({ amountCents: l.amountCents, method: l.tipMethod === "cash" || l.tipMethod === "card" ? (l.tipMethod as "cash" | "card") : null }));
  const live = (pays ?? []).filter((p) => p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded");
  const perPayment = lines && pays ? tipsPerPayment(tipParts, live) : null;
  const paidTotal = live.reduce((n, p) => n + p.amountCents, 0);
  const cardPaid = live.filter((p) => CARD_FEE_METHODS.has(p.method)).reduce((n, p) => n + p.amountCents, 0);
  const split = lines && pays ? splitTips(tipParts, paidTotal > 0 ? 1 - cardPaid / paidTotal : 0) : null;
  return ({
  id: s.id, number: s.number, status: s.status, client_id: s.clientId, appointment_id: s.appointmentId, location_id: s.locationId, currency: s.currency,
  subtotal_cents: s.subtotalCents, discount_cents: s.discountCents, tax_cents: s.taxCents, tip_cents: s.tipCents, ...(split ? { tip_cash_cents: split.cashCents, tip_card_cents: split.cardCents } : {}), total_cents: s.totalCents, paid_cents: s.paidCents,
  refunded_cents: s.refundedCents, source: s.source, closed_at: iso(s.closedAt), created_at: iso(s.createdAt),
  ...(lines ? { lines: lines.sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ id: l.id, kind: l.kind, name: l.name, quantity: l.quantity, unit_cents: l.unitCents, amount_cents: l.amountCents, tip_method: l.kind === "tip" ? (l.tipMethod === "cash" || l.tipMethod === "card" ? l.tipMethod : null) : null, staff_id: l.staffId, service_id: l.serviceId, product_id: l.productId })) } : {}),
  ...(pays ? { payments: pays.map((p) => ({ id: p.id, method: p.method, amount_cents: p.amountCents, tip_cents: perPayment ? (perPayment[p.id] ?? 0) : p.tipCents, status: p.status, created_at: iso(p.createdAt) })) } : {}),
  });
};

export async function listSalesApi(businessId: string, opts: { from?: Date; to?: Date; status?: string; clientId?: string; limit: number; offset: number }) {
  return withTenant(businessId, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(schema.sales.businessId, businessId)];
    if (opts.status) conds.push(sql`${schema.sales.status} = ${opts.status}`);
    if (opts.clientId) conds.push(eq(schema.sales.clientId, opts.clientId));
    if (opts.from) conds.push(gte(schema.sales.createdAt, opts.from));
    if (opts.to) conds.push(lt(schema.sales.createdAt, opts.to));
    const where = and(...conds);
    const [rows, [n]] = await Promise.all([
      tx.select().from(schema.sales).where(where).orderBy(desc(schema.sales.createdAt), desc(schema.sales.id)).limit(opts.limit).offset(opts.offset),
      tx.select({ n: sql<number>`count(*)` }).from(schema.sales).where(where),
    ]);
    return { rows, total: Number(n?.n ?? 0) };
  });
}
export async function getSaleApi(businessId: string, id: string) {
  return withTenant(businessId, async (tx) => {
    const s = await tx.query.sales.findFirst({ where: and(eq(schema.sales.id, id), eq(schema.sales.businessId, businessId)) });
    if (!s) return null;
    const [lines, pays] = await Promise.all([
      tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, s.id), eq(schema.saleLines.businessId, businessId))),
      tx.select().from(schema.payments).where(and(eq(schema.payments.saleId, s.id), eq(schema.payments.businessId, businessId))),
    ]);
    return serializeSale(s, lines, pays);
  });
}

// No `.default()` anywhere in these: a PATCH built with `.partial()` would otherwise apply the defaults and silently overwrite stored values
// (opting a client out of texts, say). Defaults for a create are applied in the handler instead.
export const clientPatch = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80),
  email: z.string().trim().toLowerCase().email().max(200).nullable(),
  phone: z.string().trim().max(40).nullable(),
  notes: z.string().max(5000).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  // Marketing consent is opt-in: texts only go to clients you say have agreed.
  sms_opt_in: z.boolean(),
  email_opt_in: z.boolean(),
}).partial().strict();
export const clientCreate = clientPatch.required({ first_name: true });
export const CLIENT_DEFAULTS = { last_name: "", sms_opt_in: false, email_opt_in: true } as const;
