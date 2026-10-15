import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { addServiceBody } from "@/server/api-v1-appointments";
import { addServiceToAppointment } from "@/server/booking";

/** POST /api/v1/appointments/:id/services {service_id, staff_id, start_at}: add another service to an existing visit. 409 when the time is taken or the visit can no longer change. No message is sent (the staff app does not send one either). */
export const POST = route<{ id: string }>("appointments:change", async (ctx, req, { id }) => {
  const body = await readBody(req, addServiceBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const missing = await withTenant(b, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, b)), columns: { kind: true } });
    if (!appt || appt.kind !== "visit") return "appointment";
    return firstForeign(tx, b, [[schema.services, d.service_id, "service"], [schema.staff, d.staff_id, "staff member"]]);
  });
  if (missing) return ApiErrors.notFound(missing);
  await addServiceToAppointment({ businessId: b, appointmentId: id, serviceId: d.service_id, staffId: d.staff_id, startAt: new Date(d.start_at), actorUserId: ctx.actor });
  await apiAudit(ctx, "api.appointment.add_service", "appointment", id, { serviceId: d.service_id, staffId: d.staff_id, startAt: d.start_at });
  return NextResponse.json({ data: await getAppointmentApi(b, id) }, { status: 201 });
});
