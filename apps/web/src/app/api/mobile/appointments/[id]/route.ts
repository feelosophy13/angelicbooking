import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@angelic/db";
import { mobileContext } from "@/lib/mobile-auth";
import { getAppointmentDetail } from "@/server/appointments";
import { BookingError, setAppointmentStatus } from "@/server/booking";
import { listCancellationReasons } from "@/server/cancellation-reasons";
import { triggerAppointmentWorkflows } from "@/server/workflows";
import { appointmentAccess, coversWholeAppointment, type AppointmentMode } from "@/lib/appointment-access";
import { notifyAppointment } from "@/lib/notify";
import { clientForViewer } from "@/lib/visibility";

type Ctx = Exclude<Awaited<ReturnType<typeof mobileContext>>, { error: unknown }>;

/** Whose lines the appointment still has (a colleague's cancelled line no longer makes it shared); a fully cancelled visit keeps everyone's. */
function liveStaffIds(items: { staffId: string; status: string }[]) {
  const live = items.filter((i) => i.status !== "cancelled");
  return (live.length ? live : items).map((i) => i.staffId);
}

/**
 * The same rule as the web app: "any" roles act on every appointment, "own" roles only on ones they are booked on. A status change reaches
 * every line of the visit, so someone who shares it with a colleague may read it here but not change it.
 */
function access(c: Ctx, mode: AppointmentMode, kind: string, staffIds: string[]) {
  return appointmentAccess(c.permissions, kind === "block" ? "block" : mode, c.myStaffId, staffIds);
}
const mayChange = (c: Ctx, mode: AppointmentMode, kind: string, staffIds: string[]) => coversWholeAppointment(access(c, mode, kind, staffIds));

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const c = await mobileContext(req, url.searchParams.get("slug"));
  if ("error" in c) return c.error;
  if (!c.business) return NextResponse.json({ error: "no business" }, { status: 404 });
  const d = await getAppointmentDetail(c.business.id, id);
  const staffIds = liveStaffIds(d?.items ?? []);
  if (!d || !access(c, "read", d.appointment.kind, staffIds)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const canCancel = mayChange(c, "cancel", d.appointment.kind, staffIds);
  // The client's contact details and private notes follow the client permissions, as on the web.
  return NextResponse.json({
    ...d,
    client: clientForViewer(d.client, c.permissions),
    can: { write: mayChange(c, "write", d.appointment.kind, staffIds), cancel: canCancel },
    cancelReasons: canCancel ? (await listCancellationReasons(c.business.id)).map((r) => ({ id: r.id, name: r.name })) : [],
  });
}

/**
 * PATCH { slug, status, reasonId? } → change status, with the web app's permissions. Cancelling needs a reason from the list (as on the web)
 * and leaves any deposit with the salon; refunds and fees are done on the web. A cancelled appointment can't be revived here (its time may
 * be taken), and setting the status it already has does nothing, so a double tap never texts the client twice.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = z.object({ slug: z.string(), status: z.enum(schema.appointmentStatus.enumValues), reasonId: z.string().optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const c = await mobileContext(req, body.data.slug);
  if ("error" in c) return c.error;
  if (!c.business) return NextResponse.json({ error: "no business" }, { status: 404 });
  const d = await getAppointmentDetail(c.business.id, id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { status, reasonId } = body.data;
  const staffIds = liveStaffIds(d.items);
  if (!mayChange(c, status === "cancelled" ? "cancel" : "write", d.appointment.kind, staffIds)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (d.appointment.status === status) return NextResponse.json({ ok: true });
  if (d.appointment.status === "cancelled") return NextResponse.json({ error: "This appointment is cancelled. Rebook it on the web app." }, { status: 409 });
  if (status === "cancelled" && d.appointment.kind !== "block" && !reasonId) return NextResponse.json({ error: "Choose why it is being cancelled." }, { status: 400 });
  try {
    await setAppointmentStatus(c.business.id, id, status, c.session.user.id, null, reasonId ?? null);
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: 400 });
    if ((e as { code?: string }).code === "23P01") return NextResponse.json({ error: "That time is now taken by another appointment." }, { status: 409 });
    throw e;
  }
  if (status === "cancelled") await notifyAppointment(c.business, id, "cancellation");
  if (status === "completed") await triggerAppointmentWorkflows(c.business, "appointment_completed", id);
  return NextResponse.json({ ok: true });
}
