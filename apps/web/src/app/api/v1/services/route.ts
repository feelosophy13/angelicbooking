import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, probe, readBody, route, PRICE_FIELDS } from "@/lib/api";
import { listServices, serializeService } from "@/server/api-v1";
import { SERVICE_DEFAULTS, serviceCreate } from "@/server/api-v1-more";
import { setServiceLocations } from "@/server/locations";

/** GET /api/v1/services?include_inactive=1 */
export const GET = route("catalog:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const rows = await listServices(ctx.business.id, { activeOnly: url.searchParams.get("include_inactive") !== "1", ...probe(p) });
  return list(rows.map(serializeService), p);
});

/** POST /api/v1/services. Prices are in cents. */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, serviceCreate);
  if ("error" in body) return body.error;
  const d = { ...SERVICE_DEFAULTS, ...body.data };
  const b = ctx.business.id;
  const created = await withTenant(b, async (tx) => {
    if (d.category_id && !(await tx.query.serviceCategories.findFirst({ where: and(eq(schema.serviceCategories.id, d.category_id), eq(schema.serviceCategories.businessId, b)), columns: { id: true } }))) return null;
    const [row] = await tx.insert(schema.services).values({
      businessId: b, categoryId: d.category_id ?? null, name: d.name, description: d.description ?? null, prepNotes: d.prep_notes ?? null,
      durationMin: d.duration_min, gapMin: d.gap_min, finishMin: d.finish_min, bufferAfterMin: d.buffer_after_min, priceCents: d.price_cents,
      depositType: d.deposit_type, depositCents: d.deposit_type === "flat" ? d.deposit_cents : 0, depositPercent: d.deposit_type === "percent" ? d.deposit_percent : 0,
      capacity: d.capacity, bookableOnline: d.bookable_online, active: d.active,
    }).returning();
    if (d.location_ids) await setServiceLocations(tx, b, row!.id, d.location_ids);
    return row!;
  });
  if (!created) return ApiErrors.notFound("category");
  await apiAudit(ctx, "api.service.create", "service", created.id, { name: created.name });
  return NextResponse.json({ data: serializeService(created) }, { status: 201 });
}, { fields: PRICE_FIELDS });
