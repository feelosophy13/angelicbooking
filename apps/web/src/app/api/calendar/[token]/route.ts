import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { appUrl } from "@/lib/stripe";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
const DAYS_BACK = 30;
const DAYS_AHEAD = 120;

/**
 * Subscribable iCalendar feed for one provider: every appointment on their
 * calendar from 30 days ago to 120 days ahead. The token is the only
 * credential; rotate it from the staff profile to revoke a subscription.
 * Google/Apple/Outlook poll this URL (webcal://) every few hours.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[0-9a-f]{36}$/.test(token)) return new Response("Not found", { status: 404 });
  const person = await withJobs((tx) => tx.query.staff.findFirst({ where: eq(schema.staff.calendarToken, token) }));
  if (!person) return new Response("Not found", { status: 404 });
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, person.businessId) });
  if (!business) return new Response("Not found", { status: 404 });
  const now = Date.now();
  const items = await withTenant(business.id, (tx) =>
    tx
      .select({
        id: schema.appointmentItems.id,
        appointmentId: schema.appointmentItems.appointmentId,
        serviceName: schema.appointmentItems.serviceName,
        startAt: schema.appointmentItems.startAt,
        endAt: schema.appointmentItems.endAt,
        status: schema.appointmentItems.status,
        notes: schema.appointments.notes,
        firstName: schema.clients.firstName,
        lastName: schema.clients.lastName,
        phone: schema.clients.phone,
        updatedAt: schema.appointments.updatedAt,
      })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
      .where(and(eq(schema.appointmentItems.staffId, person.id), gte(schema.appointmentItems.startAt, new Date(now - DAYS_BACK * 86_400_000)), lt(schema.appointmentItems.startAt, new Date(now + DAYS_AHEAD * 86_400_000))))
      .orderBy(asc(schema.appointmentItems.startAt)),
  );
  // One event per appointment (colour + finish segments merge into a single block).
  const byAppt = new Map<string, typeof items>();
  for (const i of items) byAppt.set(i.appointmentId, [...(byAppt.get(i.appointmentId) ?? []), i]);
  const events = [...byAppt.entries()].map(([appointmentId, segs]) => {
    const start = segs.reduce((a, b) => (a.startAt < b.startAt ? a : b)).startAt;
    const end = segs.reduce((a, b) => (a.endAt > b.endAt ? a : b)).endAt;
    const first = segs[0]!;
    const client = first.firstName ? `${first.firstName} ${first.lastName ?? ""}`.trim() : "Walk-in";
    const services = [...new Set(segs.map((s) => s.serviceName.replace(" (finish)", "")))].join(", ");
    const cancelled = segs.every((s) => s.status === "cancelled" || s.status === "no_show");
    const desc = [services, first.phone ? `Phone: ${first.phone}` : null, first.notes ? `Notes: ${first.notes}` : null, `Open: ${appUrl(`/app/${business.slug}/appointments/${appointmentId}`)}`].filter(Boolean).join("\n");
    return [
      "BEGIN:VEVENT",
      `UID:${appointmentId}@angelicbooking`,
      `DTSTAMP:${stamp(first.updatedAt)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(cancelled ? `[Cancelled] ${client}` : `${client} · ${services}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      business.addressLine ? `LOCATION:${esc(business.addressLine)}` : "",
      `URL:${appUrl(`/app/${business.slug}/appointments/${appointmentId}`)}`,
      `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  });
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Angelic Booking//Provider feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`${person.displayName} · ${business.name}`)}`,
    `X-WR-TIMEZONE:${business.timezone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
