import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { getService, serializeService } from "@/server/api-v1";
import { servicePatch } from "@/server/api-v1-more";
import { setServiceLocations } from "@/server/locations";

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const s = await getService(ctx.business.id, id);
  return s ? NextResponse.json({ data: serializeService(s) }) : ApiErrors.notFound("service");
});

/** PATCH /api/v1/services/:id: send only what changes. Set active=false to retire a service (services are never deleted: history keeps pointing at them). */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, servicePatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const cur = await tx.query.services.findFirst({ where: and(eq(schema.services.id, id), eq(schema.services.businessId, b)) });
    if (!cur) return "service" as const;
    if (d.category_id && !(await tx.query.serviceCategories.findFirst({ where: and(eq(schema.serviceCategories.id, d.category_id), eq(schema.serviceCategories.businessId, b)), columns: { id: true } }))) return "category" as const;
    const type = d.deposit_type ?? cur.depositType;
    const [row] = await tx.update(schema.services).set({
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.description !== undefined ? { description: d.description } : {}), ...(d.prep_notes !== undefined ? { prepNotes: d.prep_notes } : {}),
      ...(d.category_id !== undefined ? { categoryId: d.category_id } : {}), ...(d.duration_min !== undefined ? { durationMin: d.duration_min } : {}),
      ...(d.gap_min !== undefined ? { gapMin: d.gap_min } : {}), ...(d.finish_min !== undefined ? { finishMin: d.finish_min } : {}), ...(d.buffer_after_min !== undefined ? { bufferAfterMin: d.buffer_after_min } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}), ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
      ...(d.bookable_online !== undefined ? { bookableOnline: d.bookable_online } : {}), ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.deposit_type !== undefined || d.deposit_cents !== undefined || d.deposit_percent !== undefined
        ? { depositType: type, depositCents: type === "flat" ? (d.deposit_cents ?? cur.depositCents) : 0, depositPercent: type === "percent" ? (d.deposit_percent ?? cur.depositPercent) : 0 }
        : {}),
    }).where(and(eq(schema.services.id, id), eq(schema.services.businessId, b))).returning();
    if (d.location_ids) await setServiceLocations(tx, b, id, d.location_ids);
    return row!;
  });
  if (out === "service" || out === "category") return ApiErrors.notFound(out);
  await apiAudit(ctx, "api.service.update", "service", id, { fields: Object.keys(d) });
  return NextResponse.json({ data: serializeService(out) });
});
