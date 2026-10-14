import { NextResponse, after } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { setAppointmentStatus } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";

const body = z.object({ reason: z.string().max(500).nullish(), notify: z.boolean().default(true) });

/** POST /api/v1/appointments/:id/cancel. No fee is charged; refunds and fees stay in the staff app. */
export const POST = route<{ id: string }>("appointments:write", async (ctx, req, { id }) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const businessId = ctx.business.id;
  const current = await withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, businessId)), columns: { status: true, kind: true } }));
  if (!current || current.kind !== "visit") return ApiErrors.notFound("appointment");
  if (current.status === "cancelled") return ApiErrors.conflict("That appointment is already cancelled.");
  if (current.status === "completed") return ApiErrors.conflict("A completed appointment cannot be cancelled.");
  await setAppointmentStatus(businessId, id, "cancelled", ctx.actor, parsed.data.reason ?? null);
  await apiAudit(ctx, "api.appointment.cancel", "appointment", id, { reason: parsed.data.reason ?? null });
  if (parsed.data.notify) after(() => notifyAppointment(ctx.business, id, "cancellation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  return NextResponse.json({ data: await getAppointmentApi(businessId, id) });
});
