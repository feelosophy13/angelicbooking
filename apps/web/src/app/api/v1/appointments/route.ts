import { NextResponse } from "next/server";
import { z } from "zod";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, readBody, route } from "@/lib/api";
import { getAppointmentApi, listAppointmentsApi } from "@/server/api-v1";
import { bookAppointment } from "@/server/booking";
import { notifyAppointment } from "@/lib/notify";

const STATUSES = schema.appointmentStatus.enumValues as readonly string[];
const when = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);

/** GET /api/v1/appointments?from=&to=&status=&client_id=&staff_id= (from/to are ISO instants, matched on the start time) */
export const GET = route("appointments:read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const p = pageParams(new URL(req.url));
  const status = q.get("status");
  if (status && !STATUSES.includes(status)) return ApiErrors.invalid(`status must be one of: ${STATUSES.join(", ")}`);
  const { rows, total } = await listAppointmentsApi(ctx.business.id, { from: when(q.get("from")), to: when(q.get("to")), status: status ?? undefined, clientId: q.get("client_id") ?? undefined, staffId: q.get("staff_id") ?? undefined, limit: p.limit, offset: p.offset });
  return list(rows, p, total);
});

const createBody = z.object({
  client_id: z.string().min(1).max(100),
  service_id: z.string().min(1).max(100),
  staff_id: z.string().min(1).max(100),
  // Must carry a UTC offset (2026-11-02T14:00:00-05:00 or ...Z): a bare local time would be ambiguous.
  start_at: z.string().refine((s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), "Use an ISO 8601 time with an offset, e.g. 2026-11-02T14:00:00-05:00"),
  notes: z.string().max(2000).nullish(),
  notify: z.boolean().default(true),
});

/** POST /api/v1/appointments: book one service for a client with one staff member. 409 when the time is taken. */
export const POST = route("appointments:book", async (ctx, req) => {
  const body = await readBody(req, createBody);
  if ("error" in body) return body.error;
  const d = body.data;
  const businessId = ctx.business.id;
  // Foreign keys are not subject to row-level security, so prove each id belongs to this business before using it.
  const found = await withTenant(businessId, async (tx) => ({
    client: await tx.query.clients.findFirst({ where: and(eq(schema.clients.id, d.client_id), eq(schema.clients.businessId, businessId)), columns: { id: true } }),
    service: await tx.query.services.findFirst({ where: and(eq(schema.services.id, d.service_id), eq(schema.services.businessId, businessId)), columns: { id: true } }),
    staff: await tx.query.staff.findFirst({ where: and(eq(schema.staff.id, d.staff_id), eq(schema.staff.businessId, businessId)), columns: { id: true } }),
  }));
  if (!found.client) return ApiErrors.notFound("client");
  if (!found.service) return ApiErrors.notFound("service");
  if (!found.staff) return ApiErrors.notFound("staff member");
  const { appointmentId } = await bookAppointment({ businessId, clientId: d.client_id, serviceId: d.service_id, staffId: d.staff_id, startAt: new Date(d.start_at), notes: d.notes ?? null, createdByUserId: null, source: "staff" });
  await apiAudit(ctx, "api.appointment.create", "appointment", appointmentId, { serviceId: d.service_id, staffId: d.staff_id, startAt: d.start_at });
  if (d.notify) after(() => notifyAppointment(ctx.business, appointmentId, "confirmation").catch((e) => console.error("[api/v1] notify failed", (e as Error).message)));
  return NextResponse.json({ data: await getAppointmentApi(businessId, appointmentId) }, { status: 201 });
});
