import { NextResponse, after } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { findVisitItem, moveItemBody } from "@/server/api-v1-appointments";
import { rescheduleService } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";

/** POST /api/v1/appointments/:id/items/:itemId/move {start_at, staff_id?, notify?}: move one service of a visit (with its finishing segment), optionally to another provider. 409 when the time is taken or outside their hours; class seats cannot be moved. */
export const POST = route<{ id: string; itemId: string }>("appointments:write", async (ctx, req, { id, itemId }) => {
  const body = await readBody(req, moveItemBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  if (!(await findVisitItem(b, id, itemId))) return ApiErrors.notFound("appointment item");
  const missing = await withTenant(b, (tx) => firstForeign(tx, b, [[schema.staff, d.staff_id, "staff member"]]));
  if (missing) return ApiErrors.notFound(missing);
  await rescheduleService({ businessId: b, itemId, newStartAt: new Date(d.start_at), newStaffId: d.staff_id ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.appointment.move_service", "appointment", id, { itemId, startAt: d.start_at, staffId: d.staff_id ?? null });
  if (d.notify) after(() => notifyAppointment(ctx.business, id, "rescheduled").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  return NextResponse.json({ data: await getAppointmentApi(b, id) });
});
