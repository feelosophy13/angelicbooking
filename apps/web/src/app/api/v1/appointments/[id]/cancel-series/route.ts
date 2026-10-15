import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { cancelSeriesBody } from "@/server/api-v1-appointments";
import { cancelSeriesFrom } from "@/server/series";
import { cancelQueuedReminders, notifyAppointment } from "@/lib/notify";

/**
 * POST /api/v1/appointments/:id/cancel-series {reason?, notify?}: cancel this visit and every later open visit of its standing appointment, and end
 * the series. 409 when the visit is not part of a series. The client hears about the first cancelled visit (unless notify is false); no fee is charged.
 */
export const POST = route<{ id: string }>("appointments:write", async (ctx, req, { id }) => {
  const body = await readBody(req, cancelSeriesBody);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const appt = await withTenant(b, (tx) => tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, b)), columns: { kind: true } }));
  if (!appt || appt.kind !== "visit") return ApiErrors.notFound("appointment");
  const ids = await cancelSeriesFrom({ businessId: b, appointmentId: id, actorUserId: ctx.actor, reason: body.data.reason ?? null });
  await apiAudit(ctx, "api.series.cancel", "appointment", id, { cancelled: ids.length, reason: body.data.reason ?? null });
  // Queued reminders for every cancelled visit stop; the client is told once, about the first.
  for (const apptId of ids.slice(body.data.notify ? 1 : 0)) await cancelQueuedReminders(b, apptId);
  if (body.data.notify && ids[0]) after(() => notifyAppointment(ctx.business, ids[0]!, "cancellation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  return NextResponse.json({ data: { cancelled_appointment_ids: ids, cancelled: ids.length } });
});
