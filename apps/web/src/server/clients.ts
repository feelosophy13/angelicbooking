import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

export type ClientSort = "name" | "last_visit" | "spend" | "created";

/**
 * Search clients the way the desk types: part of a first or last name, "Jane Doe",
 * "Doe, Jane", an email, or a phone in any format (digits are compared without punctuation).
 */
export function clientSearchWhere(q: string) {
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const c = schema.clients;
  const conds = [
    ilike(c.firstName, like),
    ilike(c.lastName, like),
    ilike(c.email, like),
    sql`(${c.firstName} || ' ' || ${c.lastName}) ilike ${like}`,
    sql`(${c.lastName} || ' ' || ${c.firstName}) ilike ${like}`,
    sql`(${c.lastName} || ', ' || ${c.firstName}) ilike ${like}`,
    digits.length >= 3 ? sql`regexp_replace(coalesce(${c.phone}, ''), '\\D', '', 'g') like ${`%${digits}%`}` : ilike(c.phone, like),
  ];
  return or(...conds);
}

/** Paginated client list with last visit, visit count and lifetime spend. */
export async function listClients(businessId: string, opts: { q?: string; sort?: ClientSort; dir?: "asc" | "desc"; page?: number; pageSize?: number; locationId?: string | null }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const q = opts.q?.trim();
  return withTenant(businessId, async (tx) => {
    const search = q ? clientSearchWhere(q) : undefined;
    // "Home location" = where the client was last seen; derived, never a silo.
    const where = opts.locationId ? and(search, eq(schema.clients.homeLocationId, opts.locationId)) : search;
    const visits = tx
      .select({
        clientId: schema.appointments.clientId,
        lastVisit: sql<string | null>`max(${schema.appointmentItems.startAt}) filter (where ${schema.appointments.status} = 'completed')`.as("last_visit"),
        visitCount: sql<number>`count(distinct ${schema.appointments.id}) filter (where ${schema.appointments.status} = 'completed')`.as("visit_count"),
        noShows: sql<number>`count(distinct ${schema.appointments.id}) filter (where ${schema.appointments.status} = 'no_show')`.as("no_shows"),
      })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
      .groupBy(schema.appointments.clientId)
      .as("v");
    const spend = tx
      .select({ clientId: schema.sales.clientId, spend: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.refundedCents}), 0)`.as("spend") })
      .from(schema.sales)
      .where(sql`${schema.sales.status} in ('paid','refunded')`)
      .groupBy(schema.sales.clientId)
      .as("s");
    const orderCol =
      opts.sort === "last_visit" ? sql`v.last_visit` : opts.sort === "spend" ? sql`coalesce(s.spend, 0)` : opts.sort === "created" ? schema.clients.createdAt : sql`lower(${schema.clients.lastName}), lower(${schema.clients.firstName})`;
    const dirFn = opts.dir === "desc" ? desc : asc;
    const [rows, countRow] = await Promise.all([
      tx
        .select({
          id: schema.clients.id,
          firstName: schema.clients.firstName,
          lastName: schema.clients.lastName,
          phone: schema.clients.phone,
          email: schema.clients.email,
          createdAt: schema.clients.createdAt,
          notes: schema.clients.notes,
          homeLocationId: schema.clients.homeLocationId,
          homeLocationName: schema.locations.name,
          lastVisit: sql<Date | null>`v.last_visit`.mapWith((v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")))),
          visitCount: sql<number>`coalesce(v.visit_count, 0)`,
          noShows: sql<number>`coalesce(v.no_shows, 0)`,
          spend: sql<number>`coalesce(s.spend, 0)`,
        })
        .from(schema.clients)
        .leftJoin(visits, eq(visits.clientId, schema.clients.id))
        .leftJoin(spend, eq(spend.clientId, schema.clients.id))
        .leftJoin(schema.locations, eq(schema.locations.id, schema.clients.homeLocationId))
        .where(where)
        .orderBy(opts.sort === "last_visit" || opts.sort === "spend" ? sql`${orderCol} ${opts.dir === "desc" ? sql`desc nulls last` : sql`asc nulls first`}` : dirFn(orderCol))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ n: sql<number>`count(*)` }).from(schema.clients).where(where),
    ]);
    const total = Number(countRow[0]?.n ?? 0);
    return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });
}

// ---------------------------------------------------------------------------
// Client at a glance
// ---------------------------------------------------------------------------
export interface ClientStats {
  /** First completed visit, else when the record was created. */
  since: Date;
  sinceIsFirstVisit: boolean;
  completed: number;
  upcoming: number;
  cancelled: number;
  noShows: number;
  lastVisit: Date | null;
  nextVisit: Date | null;
  /** Paid tickets net of refunds, excluding tips. */
  spentCents: number;
  tipsCents: number;
  ticketCount: number;
  averageTicketCents: number;
  /** Most frequent completed service and provider. */
  favouriteService: string | null;
  usualProvider: string | null;
  /** Days between completed visits, averaged (null until there are two). */
  visitEveryDays: number | null;
}

export async function clientStats(tx: TenantDb, client: { id: string; createdAt: Date }): Promise<ClientStats> {
  // Raw-SQL params have no column type, so the instant goes in as ISO text and is cast.
  const now = sql`${new Date().toISOString()}::timestamptz`;
  const visitBase = and(eq(schema.appointments.clientId, client.id), eq(schema.appointments.kind, "visit"), eq(schema.appointmentItems.sortOrder, 0));
  const [[counts], [money], [fav], [prov], [gaps]] = await Promise.all([
    tx
      .select({
        completed: sql<number>`count(*) filter (where ${schema.appointments.status} = 'completed')`,
        upcoming: sql<number>`count(*) filter (where ${schema.appointments.status} in ('booked','confirmed') and ${schema.appointmentItems.startAt} >= ${now})`,
        cancelled: sql<number>`count(*) filter (where ${schema.appointments.status} = 'cancelled')`,
        noShows: sql<number>`count(*) filter (where ${schema.appointments.status} = 'no_show')`,
        first: sql<Date | null>`min(${schema.appointmentItems.startAt}) filter (where ${schema.appointments.status} = 'completed')`,
        last: sql<Date | null>`max(${schema.appointmentItems.startAt}) filter (where ${schema.appointments.status} = 'completed')`,
        next: sql<Date | null>`min(${schema.appointmentItems.startAt}) filter (where ${schema.appointments.status} in ('booked','confirmed') and ${schema.appointmentItems.startAt} >= ${now})`,
      })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(visitBase),
    tx
      .select({
        spent: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.tipCents} - ${schema.sales.refundedCents}), 0)`,
        tips: sql<number>`coalesce(sum(${schema.sales.tipCents}), 0)`,
        n: sql<number>`count(*)`,
      })
      .from(schema.sales)
      .where(and(eq(schema.sales.clientId, client.id), sql`${schema.sales.status} in ('paid','refunded')`)),
    tx
      .select({ name: schema.appointmentItems.serviceName, n: sql<number>`count(*)` })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(and(eq(schema.appointments.clientId, client.id), eq(schema.appointments.kind, "visit"), eq(schema.appointments.status, "completed")))
      .groupBy(schema.appointmentItems.serviceName)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    tx
      .select({ name: schema.staff.displayName, n: sql<number>`count(*)` })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .where(and(eq(schema.appointments.clientId, client.id), eq(schema.appointments.kind, "visit"), eq(schema.appointments.status, "completed")))
      .groupBy(schema.staff.displayName)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    tx
      .select({ days: sql<number | null>`extract(epoch from (max(${schema.appointmentItems.startAt}) - min(${schema.appointmentItems.startAt}))) / 86400 / nullif(count(distinct ${schema.appointmentItems.startAt}::date) - 1, 0)` })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(and(visitBase, eq(schema.appointments.status, "completed"))),
  ]);
  const completed = Number(counts?.completed ?? 0);
  const ticketCount = Number(money?.n ?? 0);
  const spentCents = Number(money?.spent ?? 0);
  const first = counts?.first ? new Date(counts.first) : null;
  return {
    since: first ?? client.createdAt,
    sinceIsFirstVisit: !!first,
    completed,
    upcoming: Number(counts?.upcoming ?? 0),
    cancelled: Number(counts?.cancelled ?? 0),
    noShows: Number(counts?.noShows ?? 0),
    lastVisit: counts?.last ? new Date(counts.last) : null,
    nextVisit: counts?.next ? new Date(counts.next) : null,
    spentCents,
    tipsCents: Number(money?.tips ?? 0),
    ticketCount,
    averageTicketCents: ticketCount ? Math.round(spentCents / ticketCount) : 0,
    favouriteService: fav?.name ?? null,
    usualProvider: prov?.name ?? null,
    visitEveryDays: gaps?.days != null && Number(gaps.days) > 0 ? Math.round(Number(gaps.days)) : null,
  };
}
