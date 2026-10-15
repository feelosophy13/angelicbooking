import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, probe, readBody, route } from "@/lib/api";
import { listWaitlistApi, serializeWaitlist, waitlistInput } from "@/server/api-v1-more";

/** GET /api/v1/waitlist?status=open|booked|closed */
export const GET = route("appointments:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const status = url.searchParams.get("status");
  if (status && !(schema.waitlistStatus.enumValues as readonly string[]).includes(status)) return ApiErrors.invalid("status must be open, booked or closed.");
  return list((await listWaitlistApi(ctx.business.id, probe(p), status ?? undefined)).map(serializeWaitlist), p);
});

/** POST /api/v1/waitlist: put a client on the waitlist for a date. */
export const POST = route("appointments:write", async (ctx, req) => {
  const body = await readBody(req, waitlistInput);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const row = await withTenant(b, async (tx) => {
    const [client, service, staff, location] = await Promise.all([
      tx.query.clients.findFirst({ where: and(eq(schema.clients.id, d.client_id), eq(schema.clients.businessId, b)), columns: { id: true } }),
      tx.query.services.findFirst({ where: and(eq(schema.services.id, d.service_id), eq(schema.services.businessId, b)), columns: { id: true } }),
      d.staff_id ? tx.query.staff.findFirst({ where: and(eq(schema.staff.id, d.staff_id), eq(schema.staff.businessId, b)), columns: { id: true } }) : Promise.resolve({ id: "" }),
      d.location_id ? tx.query.locations.findFirst({ where: and(eq(schema.locations.id, d.location_id), eq(schema.locations.businessId, b)), columns: { id: true } }) : Promise.resolve({ id: "" }),
    ]);
    if (!client) return "client";
    if (!service) return "service";
    if (!staff) return "staff member";
    if (!location) return "location";
    const [w] = await tx.insert(schema.waitlist).values({ businessId: b, clientId: d.client_id, serviceId: d.service_id, staffId: d.staff_id ?? null, locationId: d.location_id ?? null, date: d.date, notes: d.notes ?? null }).returning();
    return w!;
  });
  if (typeof row === "string") return ApiErrors.notFound(row);
  await apiAudit(ctx, "api.waitlist.create", "waitlist", row.id);
  return NextResponse.json({ data: serializeWaitlist(row) }, { status: 201 });
});
