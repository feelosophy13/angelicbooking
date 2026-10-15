import { NextResponse, after } from "next/server";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, readBody, route } from "@/lib/api";
import { enrolBody, getSessionApi, NO_USER } from "@/server/api-v1-appointments";
import { enrolClient } from "@/server/classes";
import { notifyAppointment } from "@/lib/notify";

/** POST /api/v1/classes/:id/enrollments {client_id, notes?, notify?}: give a client a seat (client_id may be null for a walk-in). 409 when the class is full, has started, is cancelled or the client already has a seat. Returns the class; the new booking is the roster row with the highest booked_at. */
export const POST = route<{ id: string }>("appointments:write", async (ctx, req, { id }) => {
  const body = await readBody(req, enrolBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const missing = await withTenant(b, (tx) => firstForeign(tx, b, [[schema.classSessions, id, "class"], [schema.clients, d.client_id, "client"]]));
  if (missing) return ApiErrors.notFound(missing);
  const r = await enrolClient({ businessId: b, sessionId: id, clientId: d.client_id, notes: d.notes || null, actorUserId: NO_USER });
  await apiAudit(ctx, "api.class.enrol", "appointment", r.appointmentId, { sessionId: id, clientId: d.client_id });
  if (d.notify) after(() => notifyAppointment(ctx.business, r.appointmentId, "confirmation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  return NextResponse.json({ data: { appointment_id: r.appointmentId, class: await getSessionApi(b, id) } }, { status: 201 });
});
