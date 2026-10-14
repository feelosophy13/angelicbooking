import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { InventoryError, recordMovement } from "@/server/inventory";
import { MANUAL_REASONS } from "@/lib/inventory";

const body = z.object({
  reason: z.enum(MANUAL_REASONS),
  // received adds; damage, theft, expired, lost, supplier_return and used take away (send a positive number); adjust is signed.
  quantity: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Must not be zero"),
  location_id: z.string().max(100).nullish(),
  note: z.string().max(300).nullish(),
}).strict();

/** POST /api/v1/products/:id/stock-adjustments: record a stock change. It never goes below zero (409). */
export const POST = route<{ id: string }>("inventory:write", async (ctx, req, { id }) => {
  const parsed = await readBody(req, body);
  if ("error" in parsed) return parsed.error;
  const d = parsed.data;
  const b = ctx.business.id;
  const ok = await withTenant(b, async (tx) => {
    const product = await tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)), columns: { id: true } });
    const location = d.location_id ? await tx.query.locations.findFirst({ where: and(eq(schema.locations.id, d.location_id), eq(schema.locations.businessId, b)), columns: { id: true } }) : { id: "" };
    return product ? (location ? "ok" : "location") : "product";
  });
  if (ok !== "ok") return ApiErrors.notFound(ok);
  try {
    await recordMovement({ businessId: b, productId: id, locationId: d.location_id ?? null, entered: d.quantity, reason: d.reason, note: d.note ?? null, actorUserId: ctx.actor });
  } catch (e) {
    if (e instanceof InventoryError) return ApiErrors.conflict(e.message);
    throw e;
  }
  await apiAudit(ctx, "api.stock.adjust", "product", id, d);
  const p = await withTenant(b, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, id), columns: { stockQty: true } }));
  return NextResponse.json({ data: { product_id: id, on_hand: p?.stockQty ?? null } }, { status: 201 });
});
