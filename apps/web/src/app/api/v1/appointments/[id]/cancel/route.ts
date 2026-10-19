import { NextResponse, after } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { BookingError, setAppointmentStatus } from "@/server/booking";
import { appointmentChangedSilently, notifyAppointment } from "@/lib/notify";

// A reason is required, as at the desk and in the mobile app: a managed one (`reason_id`) or a written note (`reason`).
const body = z
  .object({ reason: z.string().trim().max(500).nullish(), reason_id: z.string().nullish(), notify: z.boolean().default(true) })
  .refine((b) => !!b.reason_id || !!b.reason, { message: "Give a cancellation reason: reason (text), or reason_id (a reason set up under Settings → Cancellation reasons).", path: ["reason_id"] });

/** POST /api/v1/appointments/:id/cancel. No fee is charged; refunds and fees stay in the staff app. */
export const POST = route<{ id: string }>("appointments:cancel", async (ctx, req, { id }) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const businessId = ctx.business.id;
  const current = await withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, businessId)), columns: { status: true, kind: true } }));
  if (!current || current.kind !== "visit") return ApiErrors.notFound("appointment");
  if (current.status === "cancelled") return ApiErrors.conflict("That appointment is already cancelled.");
  if (current.status === "completed") return ApiErrors.conflict("A completed appointment cannot be cancelled.");
  try {
    await setAppointmentStatus(businessId, id, "cancelled", ctx.actor, parsed.data.reason ?? null, parsed.data.reason_id ?? null);
  } catch (e) {
    if (e instanceof BookingError) return ApiErrors.conflict(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.appointment.cancel", "appointment", id, { reason: parsed.data.reason ?? null });
  // Silent or not, the visit's reminder run is dropped and "Appointment cancelled" workflows start.
  if (parsed.data.notify) after(() => notifyAppointment(ctx.business, id, "cancellation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  else after(() => appointmentChangedSilently(ctx.business, id, "cancelled"));
  return NextResponse.json({ data: await getAppointmentApi(businessId, id) });
});
