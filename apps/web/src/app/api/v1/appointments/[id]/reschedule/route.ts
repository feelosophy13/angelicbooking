import { NextResponse, after } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { rescheduleService } from "@/server/booking";
import { appointmentChangedSilently, notifyAppointment } from "@/lib/notify";

const body = z.object({
  start_at: z.string().refine((s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), "Use an ISO 8601 time with an offset, e.g. 2026-11-02T14:00:00-05:00"),
  staff_id: z.string().min(1).max(100).nullish(),
  notify: z.boolean().default(true),
}).strict();

/** POST /api/v1/appointments/:id/reschedule {start_at, staff_id?, notify?}: moves the visit (its first service, which is the whole visit for a single-service booking); 409 when the time is taken or outside the provider's hours. */
export const POST = route<{ id: string }>("appointments:change", async (ctx, req, { id }) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const b = ctx.business.id;
  const found = await withTenant(b, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, b)), columns: { id: true, kind: true, status: true } });
    if (!appt || appt.kind !== "visit") return { missing: "appointment" } as const;
    const item = await tx.query.appointmentItems.findFirst({ where: and(eq(schema.appointmentItems.appointmentId, id), eq(schema.appointmentItems.businessId, b)), orderBy: asc(schema.appointmentItems.sortOrder), columns: { id: true } });
    const staff = d.staff_id ? await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, d.staff_id), eq(schema.staff.businessId, b)), columns: { id: true } }) : { id: "" };
    if (!item) return { missing: "appointment" } as const;
    if (!staff) return { missing: "staff member" } as const;
    return { itemId: item.id } as const;
  });
  if ("missing" in found) return ApiErrors.notFound(found.missing);
  await rescheduleService({ businessId: b, itemId: found.itemId, newStartAt: new Date(d.start_at), newStaffId: d.staff_id ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.appointment.reschedule", "appointment", id, { startAt: d.start_at, staffId: d.staff_id ?? null });
  // Silent or not, runs timed from the visit (the reminder) follow it to the new time.
  if (d.notify) after(() => notifyAppointment(ctx.business, id, "rescheduled").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  else after(() => appointmentChangedSilently(ctx.business, id, "rescheduled"));
  return NextResponse.json({ data: await getAppointmentApi(b, id) });
});
