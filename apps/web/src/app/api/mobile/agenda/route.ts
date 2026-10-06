import { NextResponse } from "next/server";
import { instantToISODate } from "@angelic/core";
import { mobileContext } from "@/lib/mobile-auth";
import { getRangeAgenda } from "@/server/agenda";

/** GET /api/mobile/agenda?slug=&date=YYYY-MM-DD → staff + items for that day. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await mobileContext(req, url.searchParams.get("slug"));
  if ("error" in c) return c.error;
  if (!c.business) return NextResponse.json({ error: "no business" }, { status: 404 });
  const tz = c.business.timezone;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date")! : instantToISODate(new Date(), tz);
  const { staff, items } = await getRangeAgenda(c.business.id, tz, date, 1);
  return NextResponse.json({
    date,
    timezone: tz,
    staff: staff.map((s) => ({ id: s.id, name: s.displayName, color: s.color })),
    items: items.map((i) => ({ ...i, startAt: i.startAt.toISOString(), endAt: i.endAt.toISOString() })),
  });
}
