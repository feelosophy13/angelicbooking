import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getAppointmentApi } from "@/server/api-v1";
import { blockTime } from "@/server/booking";

const at = z.string().refine((s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), "Use an ISO 8601 time with an offset");
const body = z.object({ staff_id: z.string().min(1).max(100), start_at: at, end_at: at, reason: z.string().trim().max(100).nullish(), location_id: z.string().max(100).nullish() }).strict();

/** POST /api/v1/blocks: take time off a provider's calendar (lunch, a training day, an outside appointment). Up to 24 hours. 409 when it collides with a booking. */
export const POST = route("appointments:write", async (ctx, req) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const b = ctx.business.id;
  const ok = await withTenant(b, async (tx) => {
    const staff = await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, d.staff_id), eq(schema.staff.businessId, b)), columns: { id: true } });
    const loc = d.location_id ? await tx.query.locations.findFirst({ where: and(eq(schema.locations.id, d.location_id), eq(schema.locations.businessId, b)), columns: { id: true } }) : { id: "" };
    return staff ? (loc ? "ok" : "location") : "staff member";
  });
  if (ok !== "ok") return ApiErrors.notFound(ok);
  const { appointmentId } = await blockTime({ businessId: b, staffId: d.staff_id, startAt: new Date(d.start_at), endAt: new Date(d.end_at), reason: d.reason ?? null, actorUserId: ctx.actor, locationId: d.location_id ?? null });
  await apiAudit(ctx, "api.block.create", "appointment", appointmentId);
  return NextResponse.json({ data: await getAppointmentApi(b, appointmentId) }, { status: 201 });
});
