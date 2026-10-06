import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@angelic/db";
import { can } from "@angelic/core";
import { mobileContext } from "@/lib/mobile-auth";
import { getAppointmentDetail } from "@/server/appointments";
import { setAppointmentStatus } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const c = await mobileContext(req, url.searchParams.get("slug"));
  if ("error" in c) return c.error;
  if (!c.business) return NextResponse.json({ error: "no business" }, { status: 404 });
  const d = await getAppointmentDetail(c.business.id, id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(d);
}

/** PATCH { slug, status } → change status (same permissions as the web app). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = z.object({ slug: z.string(), status: z.enum(schema.appointmentStatus.enumValues) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const c = await mobileContext(req, body.data.slug);
  if ("error" in c) return c.error;
  if (!c.business || !can(c.role, "appointments.write.any")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await setAppointmentStatus(c.business.id, id, body.data.status, c.session.user.id);
  if (body.data.status === "cancelled") await notifyAppointment(c.business, id, "cancellation");
  return NextResponse.json({ ok: true });
}
