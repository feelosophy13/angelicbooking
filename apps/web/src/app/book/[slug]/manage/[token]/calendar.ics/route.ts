import { getManagedAppointment } from "@/server/public-booking";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");

/** iCalendar file for the client's appointment (Apple Calendar, Outlook). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const m = await getManagedAppointment(slug, token);
  if (!m || !m.start) return new Response("Not found", { status: 404 });
  const end = m.live.reduce<Date>((e, i) => (i.endAt > e ? i.endAt : e), m.start);
  const title = `${[...new Set(m.live.map((i) => i.name.replace(" (finish)", "")))].join(", ")} at ${m.business.name}`;
  const manage = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/book/${slug}/manage/${token}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Angelic Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.appt.id}@angelicbooking`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(m.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(`With ${[...new Set(m.live.map((i) => i.staffName))].join(" & ")}. Manage or cancel: ${manage}`)}`,
    m.business.addressLine ? `LOCATION:${esc(m.business.addressLine)}` : "",
    `URL:${manage}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="appointment.ics"` } });
}
