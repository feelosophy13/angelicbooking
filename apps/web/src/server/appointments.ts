import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

export async function getAppointmentDetail(businessId: string, appointmentId: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) });
    if (!appt) return null;
    const [items, client, services, staff] = await Promise.all([
      tx
        .select({
          id: schema.appointmentItems.id,
          staffId: schema.appointmentItems.staffId,
          staffName: schema.staff.displayName,
          staffColor: schema.staff.color,
          serviceId: schema.appointmentItems.serviceId,
          serviceName: schema.appointmentItems.serviceName,
          startAt: schema.appointmentItems.startAt,
          endAt: schema.appointmentItems.endAt,
          priceCents: schema.appointmentItems.priceCents,
          status: schema.appointmentItems.status,
          sortOrder: schema.appointmentItems.sortOrder,
        })
        .from(schema.appointmentItems)
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .where(eq(schema.appointmentItems.appointmentId, appointmentId))
        .orderBy(asc(schema.appointmentItems.sortOrder), asc(schema.appointmentItems.startAt)),
      appt.clientId ? tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : Promise.resolve(null),
      tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
      tx.select().from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.displayName)),
    ]);
    return { appointment: appt, items, client: client ?? null, services, staff };
  });
}

// ---------------------------------------------------------------------------
// Appointments list (Schedule → Appointments)
// ---------------------------------------------------------------------------
export type AppointmentsView = "upcoming" | "today" | "recent" | "past";
export interface AppointmentsListFilter {
  view: AppointmentsView;
  /** Local-day bounds for "today" (absolute instants). */
  dayStart: Date;
  dayEnd: Date;
  source?: "staff" | "online" | "import" | null;
  status?: string | null;
  staffId?: string | null;
  locationId?: string | null;
  /** Visits with at least one of these services (a service, or everything in a category); null or absent = any. */
  serviceIds?: string[] | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}

/** Client visits as rows: first start, every service, the first provider, who booked it and how. */
export async function listAppointments(businessId: string, f: AppointmentsListFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, f.pageSize ?? 50));
  const now = new Date();
  return withTenant(businessId, async (tx) => {
    // One row per appointment from its items.
    const it = tx
      .select({
        appointmentId: schema.appointmentItems.appointmentId,
        startAt: sql<Date>`min(${schema.appointmentItems.startAt})`.as("start_at"),
        endAt: sql<Date>`max(${schema.appointmentItems.endAt})`.as("end_at"),
        services: sql<string>`string_agg(${schema.appointmentItems.serviceName}, ', ' order by ${schema.appointmentItems.sortOrder})`.as("services"),
        staffId: sql<string>`(array_agg(${schema.appointmentItems.staffId} order by ${schema.appointmentItems.sortOrder}))[1]`.as("staff_id"),
        staffCount: sql<number>`count(distinct ${schema.appointmentItems.staffId})`.as("staff_count"),
        priceCents: sql<number>`sum(${schema.appointmentItems.priceCents})`.as("price_cents"),
      })
      .from(schema.appointmentItems)
      .groupBy(schema.appointmentItems.appointmentId)
      .as("it");
    // Aggregated columns have no type on the wire: pass instants as ISO text and cast them.
    const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
    const conds = [eq(schema.appointments.kind, "visit")];
    if (f.view === "upcoming") conds.push(gte(it.startAt, ts(now)));
    if (f.view === "today") conds.push(gte(it.startAt, ts(f.dayStart)), lt(it.startAt, ts(f.dayEnd)));
    if (f.view === "past") conds.push(lt(it.startAt, ts(now)));
    if (f.source) conds.push(eq(schema.appointments.source, f.source));
    if (f.status) conds.push(sql`${schema.appointments.status} = ${f.status}`);
    if (f.staffId) conds.push(eq(it.staffId, f.staffId));
    if (f.locationId) conds.push(eq(schema.appointments.locationId, f.locationId));
    if (f.serviceIds) {
      conds.push(f.serviceIds.length ? sql`exists (select 1 from appointment_items ai_svc where ai_svc.appointment_id = ${schema.appointments.id} and ai_svc.service_id in (${sql.join(f.serviceIds.map((id) => sql`${id}`), sql`, `)}))` : sql`false`);
    }
    const q = f.q?.trim();
    if (q) {
      const like = `%${q}%`;
      conds.push(or(ilike(schema.clients.firstName, like), ilike(schema.clients.lastName, like), ilike(sql`${schema.clients.firstName} || ' ' || ${schema.clients.lastName}`, like), ilike(schema.clients.phone, like), ilike(schema.clients.email, like), ilike(it.services, like))!);
    }
    const where = and(...conds);
    const base = () =>
      tx
        .select({
          id: schema.appointments.id,
          status: schema.appointments.status,
          source: schema.appointments.source,
          locationId: schema.appointments.locationId,
          createdAt: schema.appointments.createdAt,
          depositCents: schema.appointments.depositCents,
          startAt: it.startAt,
          endAt: it.endAt,
          services: it.services,
          staffId: it.staffId,
          staffCount: it.staffCount,
          priceCents: it.priceCents,
          staffName: schema.staff.displayName,
          clientId: schema.clients.id,
          firstName: schema.clients.firstName,
          lastName: schema.clients.lastName,
        })
        .from(schema.appointments)
        .innerJoin(it, eq(it.appointmentId, schema.appointments.id))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .leftJoin(schema.staff, eq(schema.staff.id, it.staffId))
        .where(where);
    const order = f.view === "recent" ? desc(schema.appointments.createdAt) : f.view === "past" ? desc(it.startAt) : asc(it.startAt);
    const [rows, [cnt]] = await Promise.all([
      base().orderBy(order).limit(pageSize).offset((page - 1) * pageSize),
      tx.select({ n: sql<number>`count(*)` }).from(schema.appointments).innerJoin(it, eq(it.appointmentId, schema.appointments.id)).leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId)).where(where),
    ]);
    return { rows, total: Number(cnt?.n ?? 0), page, pageSize };
  });
}
