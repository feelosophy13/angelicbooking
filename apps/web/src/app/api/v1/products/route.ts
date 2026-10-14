import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, pageParams, readBody, route } from "@/lib/api";
import { listProducts, serializeProduct } from "@/server/api-v1";
import { PRODUCT_DEFAULTS, productCreate } from "@/server/api-v1-more";
import { codeTaken } from "@/server/inventory";

/** GET /api/v1/products: active products. Cost, supplier and reorder settings are not exposed. */
export const GET = route("catalog:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await listProducts(ctx.business.id, { limit: p.limit, offset: p.offset });
  return list(rows.map(serializeProduct), p);
});

/** POST /api/v1/products. A barcode or SKU can belong to one product only (409 otherwise). */
export const POST = route("catalog:write", async (ctx, req) => {
  const body = await readBody(req, productCreate);
  if ("error" in body) return body.error;
  const d = { ...PRODUCT_DEFAULTS, ...body.data };
  const b = ctx.business.id;
  for (const [field, code] of [["barcode", d.barcode], ["sku", d.sku]] as const) {
    if (!code) continue;
    const owner = await codeTaken(b, code);
    if (owner) return ApiErrors.conflict(`${owner} already uses this ${field}.`);
  }
  const retail = d.kind === "retail";
  const created = await withTenant(b, async (tx) => {
    if (d.category_id && !(await tx.query.productCategories.findFirst({ where: and(eq(schema.productCategories.id, d.category_id), eq(schema.productCategories.businessId, b)), columns: { id: true } }))) return null;
    const [row] = await tx.insert(schema.products).values({
      businessId: b, categoryId: d.category_id ?? null, name: d.name, description: d.description ?? null, kind: d.kind, sku: d.sku ?? null, barcode: d.barcode ?? null,
      priceCents: d.price_cents, costCents: d.cost_cents, taxable: d.taxable, sellOnline: retail ? d.sell_online : false, trackStock: retail ? d.track_stock : true,
      lowStockThreshold: d.low_stock_threshold, active: d.active,
    }).returning();
    return row!;
  });
  if (!created) return ApiErrors.notFound("category");
  await apiAudit(ctx, "api.product.create", "product", created.id, { name: created.name });
  return NextResponse.json({ data: serializeProduct(created) }, { status: 201 });
});
