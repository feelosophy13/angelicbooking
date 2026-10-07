import { and, asc, eq, gte, lt } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { salesReport } from "@/server/sales";
import { csvResponse } from "@/lib/csv";
import { shiftISODate } from "@/lib/utils";

/** CSV export of closed sales or appointments for a date range: ?kind=sales|appointments&from&to */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const url = new URL(req.url);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : today;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : from;
  const start = zonedToInstant(from, "00:00", tz);
  const end = zonedToInstant(shiftISODate(to, 1), "00:00", tz);
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, dateStyle: "short", timeStyle: "short", hour12: false }).format(d) : "");
  const $ = (c: number) => (c / 100).toFixed(2);

  if (url.searchParams.get("kind") === "appointments") {
    const rows = await withTenant(business.id, (tx) =>
      tx
        .select({ start: schema.appointmentItems.startAt, end: schema.appointmentItems.endAt, service: schema.appointmentItems.serviceName, staff: schema.staff.displayName, status: schema.appointments.status, source: schema.appointments.source, first: schema.clients.firstName, last: schema.clients.lastName, phone: schema.clients.phone, price: schema.appointmentItems.priceCents, notes: schema.appointments.notes })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
        .where(and(gte(schema.appointmentItems.startAt, start), lt(schema.appointmentItems.startAt, end)))
        .orderBy(asc(schema.appointmentItems.startAt)),
    );
    return csvResponse(`appointments-${from}-${to}.csv`, ["Start", "End", "Client", "Phone", "Service", "Staff", "Status", "Source", "Price", "Notes"], rows.map((r) => [fmt(r.start), fmt(r.end), `${r.first ?? ""} ${r.last ?? ""}`.trim(), r.phone, r.service, r.staff, r.status, r.source, $(r.price), r.notes]));
  }
  const { sales } = await salesReport(business.id, start, end);
  return csvResponse(`sales-${from}-${to}.csv`, ["Sale #", "Closed", "Client", "Status", "Subtotal", "Discount", "Tax", "Tips", "Total", "Refunded"], sales.map((s) => [s.number, fmt(s.closedAt), s.clientFirst ? `${s.clientFirst} ${s.clientLast ?? ""}`.trim() : "Walk-in", s.status, $(s.subtotalCents), $(s.discountCents), $(s.taxCents), $(s.tipCents), $(s.totalCents), $(s.refundedCents)]));
}
