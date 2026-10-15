import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { classCancelBody, getSessionApi } from "@/server/api-v1-appointments";
import { cancelSession } from "@/server/classes";
import { notifyAppointment } from "@/lib/notify";

/** POST /api/v1/classes/:id/cancel {reason?, notify?}: cancel the session and every open seat in it. With notify (default true) each client is told. No refunds are made. */
export const POST = route<{ id: string }>("appointments:write", async (ctx, req, { id }) => {
  const body = await readBody(req, classCancelBody);
  if ("error" in body) return body.error;
  const b = ctx.business.id;
  const s = await withTenant(b, (tx) => tx.query.classSessions.findFirst({ where: and(eq(schema.classSessions.id, id), eq(schema.classSessions.businessId, b)), columns: { status: true } }));
  if (!s) return ApiErrors.notFound("class");
  if (s.status === "cancelled") return ApiErrors.conflict("That class is already cancelled.");
  const ids = await cancelSession({ businessId: b, sessionId: id, actorUserId: ctx.actor, reason: body.data.reason || null });
  await apiAudit(ctx, "api.class.cancel", "class_session", id, { seats: ids.length, reason: body.data.reason ?? null });
  if (body.data.notify) {
    after(async () => {
      for (const apptId of ids) await notifyAppointment(ctx.business, apptId, "cancellation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message));
    });
  }
  return NextResponse.json({ data: { ...(await getSessionApi(b, id)), cancelled_appointment_ids: ids } });
});
