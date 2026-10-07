import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

export type ClientSort = "name" | "last_visit" | "spend" | "created";

/** Paginated client list with last visit, visit count and lifetime spend. */
export async function listClients(businessId: string, opts: { q?: string; sort?: ClientSort; dir?: "asc" | "desc"; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const q = opts.q?.trim();
  return withTenant(businessId, async (tx) => {
    const where = q
      ? or(ilike(schema.clients.firstName, `%${q}%`), ilike(schema.clients.lastName, `%${q}%`), ilike(schema.clients.phone, `%${q}%`), ilike(schema.clients.email, `%${q}%`))
      : undefined;
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
          lastVisit: sql<Date | null>`v.last_visit`.mapWith((v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")))),
          visitCount: sql<number>`coalesce(v.visit_count, 0)`,
          noShows: sql<number>`coalesce(v.no_shows, 0)`,
          spend: sql<number>`coalesce(s.spend, 0)`,
        })
        .from(schema.clients)
        .leftJoin(visits, eq(visits.clientId, schema.clients.id))
        .leftJoin(spend, eq(spend.clientId, schema.clients.id))
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
