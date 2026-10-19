import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { clientCohorts, lapsedClients, salesReport } from "@/server/sales";
import { canSeeClientContact, canSeeClientSpend } from "@/lib/visibility";
import { serviceIdsInScope } from "@/server/service-groups";
import { listCategories } from "@/server/categories";
import { rollUpCategories } from "@/lib/category-rollup";
import { payByCategory } from "@/server/payroll";
import { csvResponse } from "@/lib/csv";
import { shiftISODate } from "@/lib/utils";

/** CSV export of closed sales, appointments, revenue by category or client cohorts for a date range: ?kind=sales|appointments|categories|clients&from&to */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "reports.view");
  const url = new URL(req.url);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : today;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : from;
  const start = zonedToInstant(from, "00:00", tz);
  const end = zonedToInstant(shiftISODate(to, 1), "00:00", tz);
  const locationId = url.searchParams.get("location") || null;
  // Same filter as the page: one service, or a category and everything under it (`c:<id>`).
  const serviceIds = await serviceIdsInScope(business.id, url.searchParams.get("service"));
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short", timeStyle: "short", hour12: false }).format(d) : "");
  const $ = (c: number) => (c / 100).toFixed(2);

  if (url.searchParams.get("kind") === "appointments") {
    const rows = await withTenant(business.id, (tx) =>
      tx
        .select({ start: schema.appointmentItems.startAt, end: schema.appointmentItems.endAt, service: schema.appointmentItems.serviceName, staff: schema.staff.displayName, location: schema.locations.name, status: schema.appointments.status, source: schema.appointments.source, first: schema.clients.firstName, last: schema.clients.lastName, phone: schema.clients.phone, price: schema.appointmentItems.priceCents, notes: schema.appointments.notes })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .leftJoin(schema.locations, eq(schema.locations.id, schema.appointments.locationId))
        .where(and(gte(schema.appointmentItems.startAt, start), lt(schema.appointmentItems.startAt, end), ...(locationId ? [eq(schema.appointments.locationId, locationId)] : []), ...(serviceIds ? [serviceIds.length ? inArray(schema.appointmentItems.serviceId, serviceIds) : sql`false`] : [])))
        .orderBy(asc(schema.appointmentItems.startAt)),
    );
    // Client phone numbers are client data: they come along only for someone who may also view clients.
    const withPhone = can(permissions, "clients.read");
    const header = ["Start", "End", "Client", ...(withPhone ? ["Phone"] : []), "Service", "Staff", "Location", "Status", "Source", "Price", "Notes"];
    return csvResponse(`appointments-${from}-${to}.csv`, header, rows.map((r) => [fmt(r.start), fmt(r.end), `${r.first ?? ""} ${r.last ?? ""}`.trim(), ...(withPhone ? [r.phone] : []), r.service, r.staff, r.location, r.status, r.source, $(r.price), r.notes]));
  }
  if (url.searchParams.get("kind") === "categories") {
    // The page's "Revenue by service category" table, one row per top-level category and one per sub-category under it. Pay columns
    // need the payroll permission and no service filter (pay is not split by service), like the page.
    const withPay = can(permissions, "payroll.manage") && !serviceIds;
    const [{ byCategory }, categories, pay] = await Promise.all([salesReport(business.id, start, end, locationId, serviceIds), listCategories(business.id, "service"), withPay ? payByCategory(business, { start: from, end: to }, locationId) : null]);
    const rows = rollUpCategories(byCategory, categories, pay);
    const header = ["Category", "Sub-category", "Qty", "Services", "From packages & memberships", "Total", ...(withPay ? ["Provider pay", "Profit"] : [])];
    const line = (parent: string, sub: string, r: { count: number; paid: number; credit: number; pay: number | null }) => [parent, sub, r.count, $(r.paid), $(r.credit), $(r.paid + r.credit), ...(withPay ? [$(r.pay ?? 0), $(r.paid + r.credit - (r.pay ?? 0))] : [])];
    const out = rows.flatMap((t) => [line(t.name, "", t), ...t.children.map((c) => line(t.name, c.name, c))]);
    const all = { count: rows.reduce((n, r) => n + r.count, 0), paid: rows.reduce((n, r) => n + r.paid, 0), credit: rows.reduce((n, r) => n + r.credit, 0), pay: withPay ? rows.reduce((n, r) => n + (r.pay ?? 0), 0) : null };
    return csvResponse(`revenue-by-category-${from}-${to}.csv`, header, [...out, line("All services", "", all)]);
  }
  if (url.searchParams.get("kind") === "clients") {
    // The page's Clients card: the figures against the previous equal-length period, then every client lapsed right now (the page shows
    // the top ten). Visits are not split by service, so the service filter is ignored here as it is on the page.
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
    const prevStart = zonedToInstant(shiftISODate(from, -days), "00:00", tz);
    const opts = { lapsedDays: business.lapsedAfterDays, locationId };
    const [cur, before, lapsed] = await Promise.all([clientCohorts(business.id, start, end, opts), clientCohorts(business.id, prevStart, start, opts), lapsedClients(business.id, { ...opts, limit: null })]);
    const retention = (c: typeof cur) => (c.dueBack > 0 ? `${Math.round((c.retained / c.dueBack) * 100)}%` : "");
    const withContact = canSeeClientContact(permissions);
    const withSpend = canSeeClientSpend(permissions);
    const base = `${url.origin}/app/${slug}/clients/`;
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short" }).format(d);
    const rows: (string | number | null)[][] = [
      ["New clients", cur.fresh.count, before.fresh.count],
      ["New client revenue", $(cur.fresh.revenueCents), $(before.fresh.revenueCents)],
      ["Returning clients", cur.returning.count, before.returning.count],
      ["Returning client revenue", $(cur.returning.revenueCents), $(before.returning.revenueCents)],
      [`Due back (${cur.lapsedDays}-day setting)`, cur.dueBack, before.dueBack],
      ["Retained", cur.retained, before.retained],
      ["Lost", cur.lost, before.lost],
      ["Retention", retention(cur), retention(before)],
      [],
      ["Lapsed right now", lapsed.count],
      ["Spent in the year before lapsing", $(lapsed.revenueCents)],
      [],
      ["Lapsed client", ...(withContact ? ["Phone", "Email"] : []), "Last visit", "Visits", ...(withSpend ? ["Spent, year before lapsing"] : []), "Client page"],
      ...lapsed.top.map((c) => [`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(), ...(withContact ? [c.phone, c.email] : []), day(c.lastVisit), c.visits, ...(withSpend ? [$(c.spendCents)] : []), `${base}${c.clientId}`]),
    ];
    return csvResponse(`clients-${from}-${to}.csv`, ["Metric", `${from} to ${to}`, "Previous period"], rows);
  }
  const { sales } = await salesReport(business.id, start, end, locationId, serviceIds);
  return csvResponse(`sales-${from}-${to}.csv`, ["Sale #", "Closed", "Location", "Client", "Status", "Subtotal", "Discount", "Tax", "Tips", "Total", "Refunded"], sales.map((s) => [s.number, fmt(s.closedAt), s.locationName, s.clientFirst ? `${s.clientFirst} ${s.clientLast ?? ""}`.trim() : "Walk-in", s.status, $(s.subtotalCents), $(s.discountCents), $(s.taxCents), $(s.tipCents), $(s.totalCents), $(s.refundedCents)]));
}
