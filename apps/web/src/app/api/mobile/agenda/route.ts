import { NextResponse } from "next/server";
import { instantToISODate } from "@angelic/core";
import { mobileContext } from "@/lib/mobile-auth";
import { getRangeAgenda } from "@/server/agenda";
import { seesNoCalendar, seesOwnOnly } from "@/lib/appointment-access";
import { can } from "@angelic/core";
import { canSeeClientContact, canSeePrices } from "@/lib/visibility";

/** GET /api/mobile/agenda?slug=&date=YYYY-MM-DD → staff + items for that day. A role that sees only its own calendar gets only its own column. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await mobileContext(req, url.searchParams.get("slug"));
  if ("error" in c) return c.error;
  if (!c.business) return NextResponse.json({ error: "no business" }, { status: 404 });
  if (seesNoCalendar(c.permissions)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const tz = c.business.timezone;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : instantToISODate(new Date(), tz);
  const { staff, items } = await getRangeAgenda(c.business.id, tz, date, 1);
  const ownOnly = seesOwnOnly(c.permissions);
  const mine = (staffId: string) => !ownOnly || (c.myStaffId !== null && staffId === c.myStaffId);
  // What of a visit this login may see, as on the web calendar: the client's phone, the visit's notes and the price each follow a permission.
  const contact = canSeeClientContact(c.permissions);
  const notes = can(c.permissions, "clients.notes");
  const prices = canSeePrices(c.permissions);
  return NextResponse.json({
    date,
    timezone: tz,
    staff: staff.filter((s) => mine(s.id)).map((s) => ({ id: s.id, name: s.displayName, color: s.color })),
    items: items.filter((i) => mine(i.staffId)).map(({ clientPhone, notes: visitNotes, priceCents, depositCents, depositStatus, ...i }) => ({
      ...i,
      startAt: i.startAt.toISOString(),
      endAt: i.endAt.toISOString(),
      ...(contact ? { clientPhone } : {}),
      ...(notes ? { notes: visitNotes } : { notes: null }),
      ...(prices ? { priceCents, depositCents, depositStatus } : { priceCents: 0 }),
    })),
  });
}
