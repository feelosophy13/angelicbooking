/**
 * "All my businesses": a read-only roll-up across every tenant the signed-in
 * user belongs to. Each business is read inside its own tenant transaction
 * (RLS), with that business's own permissions deciding what is shown.
 */
import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { can, instantToISODate, zonedToInstant, type Permissions } from "@angelic/core";
import { permissionsForRole } from "@/server/roles";
import { shiftISODate } from "@/lib/utils";

export type MyBusiness = { business: typeof schema.businesses.$inferSelect; role: string; permissions: Permissions };

/** Businesses the user belongs to, with resolved permissions, in name order. */
export async function myBusinesses(userId: string): Promise<MyBusiness[]> {
  const rows = await db
    .select({ business: schema.businesses, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.businesses.name));
  return Promise.all(rows.map(async (r) => ({ business: r.business, role: r.role, permissions: await permissionsForRole(r.business.id, r.role) })));
}

export interface Snapshot {
  today: { total: number; done: number; unconfirmed: number; noShows: number; expectedCents: number };
  nextUp: { startAt: Date; clientName: string | null; serviceName: string; staffName: string; appointmentId: string } | null;
  upcoming7: number;
  /** Null when the user may not see sales for this business. */
  sales: { todayCents: number; monthCents: number; monthTickets: number } | null;
  openTickets: number;
}

const LIVE = ["booked", "confirmed", "checked_in", "in_progress", "completed"] as const;

export async function businessSnapshot({ business, permissions }: MyBusiness, now = new Date()): Promise<Snapshot> {
  const tz = business.timezone;
  const today = instantToISODate(now, tz);
  const dayStart = zonedToInstant(today, "00:00", tz);
  const dayEnd = zonedToInstant(shiftISODate(today, 1), "00:00", tz);
  const weekEnd = zonedToInstant(shiftISODate(today, 7), "00:00", tz);
  const monthStart = zonedToInstant(`${today.slice(0, 7)}-01`, "00:00", tz);
  return withTenant(business.id, async (tx) => {
    const firstItems = and(eq(schema.appointmentItems.sortOrder, 0), sql`${schema.appointments.status} <> 'cancelled'`);
    const [todayRows, [week], next, sales, [open]] = await Promise.all([
      tx
        .select({ status: schema.appointments.status, price: sql<number>`coalesce(sum(${schema.appointmentItems.priceCents}), 0)`, n: sql<number>`count(distinct ${schema.appointments.id})` })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(gte(schema.appointmentItems.startAt, dayStart), lt(schema.appointmentItems.startAt, dayEnd), sql`${schema.appointmentItems.status} <> 'cancelled'`))
        .groupBy(schema.appointments.status),
      tx
        .select({ n: sql<number>`count(distinct ${schema.appointments.id})` })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(firstItems, gte(schema.appointmentItems.startAt, dayEnd), lt(schema.appointmentItems.startAt, weekEnd))),
      tx
        .select({ appointmentId: schema.appointments.id, startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, staffName: schema.staff.displayName, first: schema.clients.firstName, last: schema.clients.lastName })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .where(and(eq(schema.appointmentItems.sortOrder, 0), gte(schema.appointmentItems.startAt, now), lt(schema.appointmentItems.startAt, dayEnd), inArray(schema.appointments.status, ["booked", "confirmed"])))
        .orderBy(asc(schema.appointmentItems.startAt))
        .limit(1),
      can(permissions, "reports.view")
        ? tx
            .select({
              todayCents: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.tipCents}) filter (where ${schema.sales.closedAt} >= ${dayStart.toISOString()}::timestamptz), 0)`,
              monthCents: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.tipCents}), 0)`,
              monthTickets: sql<number>`count(*)`,
            })
            .from(schema.sales)
            .where(and(gte(schema.sales.closedAt, monthStart), lt(schema.sales.closedAt, dayEnd), sql`${schema.sales.status} in ('paid','refunded')`))
        : Promise.resolve(null),
      tx.select({ n: sql<number>`count(*)` }).from(schema.sales).where(eq(schema.sales.status, "open")),
    ]);
    const by = (st: string) => Number(todayRows.find((r) => r.status === st)?.n ?? 0);
    const live = todayRows.filter((r) => (LIVE as readonly string[]).includes(r.status));
    const n = next[0];
    return {
      today: {
        total: live.reduce((s, r) => s + Number(r.n), 0),
        done: by("completed"),
        unconfirmed: by("booked"),
        noShows: by("no_show"),
        expectedCents: live.reduce((s, r) => s + Number(r.price), 0),
      },
      nextUp: n ? { startAt: n.startAt, clientName: n.first ? `${n.first} ${n.last ?? ""}`.trim() : null, serviceName: n.serviceName.replace(" (finish)", ""), staffName: n.staffName, appointmentId: n.appointmentId } : null,
      upcoming7: Number(week?.n ?? 0),
      sales: sales?.[0] ? { todayCents: Number(sales[0].todayCents), monthCents: Number(sales[0].monthCents), monthTickets: Number(sales[0].monthTickets) } : null,
      openTickets: Number(open?.n ?? 0),
    };
  });
}

export interface DirectoryHit {
  business: { id: string; name: string; slug: string };
  client: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; lastVisit: Date | null };
}

/** Search clients by name, phone or email across the businesses where the user may read clients. */
export async function searchClientsAcross(mine: MyBusiness[], q: string, limitPerBusiness = 8): Promise<DirectoryHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const out: DirectoryHit[] = [];
  for (const m of mine.filter((x) => can(x.permissions, "clients.read"))) {
    const rows = await withTenant(m.business.id, (tx) =>
      tx
        .select({
          id: schema.clients.id,
          firstName: schema.clients.firstName,
          lastName: schema.clients.lastName,
          phone: schema.clients.phone,
          email: schema.clients.email,
          // Drizzle renders the outer column unqualified inside a subquery, so name it by hand.
          lastVisit: sql<Date | null>`(select max(ai.start_at) from appointment_items ai join appointments a on a.id = ai.appointment_id where a.client_id = clients.id and a.status = 'completed')`,
        })
        .from(schema.clients)
        .where(
          or(
            ilike(sql`${schema.clients.firstName} || ' ' || ${schema.clients.lastName}`, `%${term}%`),
            ilike(schema.clients.email, `%${term}%`),
            ...(digits.length >= 4 ? [ilike(schema.clients.phone, `%${digits}%`)] : []),
          ),
        )
        .orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName))
        .limit(limitPerBusiness),
    );
    for (const c of rows) out.push({ business: { id: m.business.id, name: m.business.name, slug: m.business.slug }, client: { ...c, lastVisit: c.lastVisit ? new Date(c.lastVisit) : null } });
  }
  return out;
}
