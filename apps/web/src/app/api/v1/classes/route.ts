import { NextResponse } from "next/server";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, firstForeign, list, pageParams, readBody, route } from "@/lib/api";
import { classCreate, getSessionApi, listSessionsApi, NO_USER } from "@/server/api-v1-appointments";
import { createSession } from "@/server/classes";

const DAY = 86_400_000;
const when = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);

/** GET /api/v1/classes?from=&to=&service_id=&include_cancelled=true: scheduled class sessions with seats booked and left. Defaults to the next 60 days; a window is at most a year. */
export const GET = route("appointments:read", async (ctx, req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  const p = pageParams(url);
  const from = when(q.get("from")) ?? new Date();
  const to = when(q.get("to")) ?? new Date(from.getTime() + 60 * DAY);
  if (to <= from) return ApiErrors.invalid("to must be after from.");
  if (to.getTime() - from.getTime() > 366 * DAY) return ApiErrors.invalid("from and to can be at most a year apart.");
  const serviceId = q.get("service_id");
  if (serviceId) {
    const missing = await withTenant(ctx.business.id, (tx) => firstForeign(tx, ctx.business.id, [[schema.services, serviceId, "service"]]));
    if (missing) return ApiErrors.notFound(missing);
  }
  const rows = await listSessionsApi(ctx.business.id, { from, to, serviceId, includeCancelled: q.get("include_cancelled") === "true" });
  return list(rows.slice(p.offset, p.offset + p.limit), p, rows.length);
});

/** POST /api/v1/classes {service_id, staff_id, start_at, capacity?, notes?}: schedule a class session. The service must have a group size above 1; 409 when the instructor is not free then. */
export const POST = route("appointments:write", async (ctx, req) => {
  const body = await readBody(req, classCreate);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const missing = await withTenant(b, (tx) => firstForeign(tx, b, [[schema.services, d.service_id, "service"], [schema.staff, d.staff_id, "staff member"]]));
  if (missing) return ApiErrors.notFound(missing);
  const row = await createSession({ businessId: b, timeZone: ctx.business.timezone, slotIntervalMin: ctx.business.slotIntervalMin, serviceId: d.service_id, staffId: d.staff_id, startAt: new Date(d.start_at), capacity: d.capacity ?? null, notes: d.notes || null, actorUserId: NO_USER });
  await apiAudit(ctx, "api.class.schedule", "class_session", row.id, { serviceId: d.service_id, staffId: d.staff_id, startAt: d.start_at });
  return NextResponse.json({ data: await getSessionApi(b, row.id) }, { status: 201 });
});

void z;
