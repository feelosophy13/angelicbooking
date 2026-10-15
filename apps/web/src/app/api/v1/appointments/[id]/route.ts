import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { setAppointmentStatus, updateAppointmentNotes } from "@/server/booking";

export const GET = route<{ id: string }>("appointments:read", async (ctx, _req, { id }) => {
  const a = await getAppointmentApi(ctx.business.id, id);
  return a ? NextResponse.json({ data: a }) : ApiErrors.notFound("appointment");
});

const patchBody = z.object({
  // Cancelling has its own endpoint, because it notifies the client and records a reason.
  status: z.enum(["booked", "confirmed", "checked_in", "in_progress", "completed", "no_show"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

/** PATCH /api/v1/appointments/:id: change the status or the notes. */
export const PATCH = route<{ id: string }>("appointments:change", async (ctx, req, { id }) => {
  const body = await readBody(req, patchBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const businessId = ctx.business.id;
  const current = await withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, businessId)), columns: { id: true, status: true, kind: true } }));
  if (!current || current.kind !== "visit") return ApiErrors.notFound("appointment");
  if (current.status === "cancelled") return ApiErrors.conflict("A cancelled appointment cannot be changed.");
  if (d.status && d.status !== current.status) await setAppointmentStatus(businessId, id, d.status, ctx.actor);
  if (d.notes !== undefined) await updateAppointmentNotes(businessId, id, d.notes, ctx.actor);
  await apiAudit(ctx, "api.appointment.update", "appointment", id, d);
  return NextResponse.json({ data: await getAppointmentApi(businessId, id) });
});
