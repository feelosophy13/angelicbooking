import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, readBody, route } from "@/lib/api";
import { serializeProduct } from "@/server/api-v1";
import { productPatch } from "@/server/api-v1-more";
import { codeTaken } from "@/server/inventory";

const find = (b: string, id: string) => withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, id), eq(schema.products.businessId, b)) }));

export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => {
  const p = await find(ctx.business.id, id);
  return p ? NextResponse.json({ data: serializeProduct(p) }) : ApiErrors.notFound("product");
});

/** PATCH /api/v1/products/:id. Stock counts are changed through /stock-adjustments, never here. Set active=false to retire a product. */
export const PATCH = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, productPatch);
  if ("error" in body) return body.error;
  const d = body.data;
  const b = ctx.business.id;
  const cur = await find(b, id);
  if (!cur) return ApiErrors.notFound("product");
  for (const [field, code, was] of [["barcode", d.barcode, cur.barcode], ["sku", d.sku, cur.sku]] as const) {
    if (!code || code === was) continue;
    const owner = await codeTaken(b, code, id);
    if (owner) return ApiErrors.conflict(`${owner} already uses this ${field}.`);
  }
  const out = await withTenant(b, async (tx) => {
    if (d.category_id && !(await tx.query.productCategories.findFirst({ where: and(eq(schema.productCategories.id, d.category_id), eq(schema.productCategories.businessId, b)), columns: { id: true } }))) return null;
    const [row] = await tx.update(schema.products).set({
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.description !== undefined ? { description: d.description } : {}), ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.category_id !== undefined ? { categoryId: d.category_id } : {}), ...(d.sku !== undefined ? { sku: d.sku } : {}), ...(d.barcode !== undefined ? { barcode: d.barcode } : {}),
      ...(d.price_cents !== undefined ? { priceCents: d.price_cents } : {}), ...(d.cost_cents !== undefined ? { costCents: d.cost_cents } : {}), ...(d.taxable !== undefined ? { taxable: d.taxable } : {}),
      ...(d.sell_online !== undefined ? { sellOnline: d.sell_online } : {}), ...(d.track_stock !== undefined ? { trackStock: d.track_stock } : {}),
      ...(d.low_stock_threshold !== undefined ? { lowStockThreshold: d.low_stock_threshold } : {}), ...(d.active !== undefined ? { active: d.active } : {}),
    }).where(and(eq(schema.products.id, id), eq(schema.products.businessId, b))).returning();
    return row!;
  });
  if (!out) return ApiErrors.notFound("category");
  await apiAudit(ctx, "api.product.update", "product", id, { fields: Object.keys(d) });
  return NextResponse.json({ data: serializeProduct(out) });
});
