import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { list, pageParams, route } from "@/lib/api";

/**
 * GET /api/v1/inventory: products whose stock is tracked, with the count on hand and whether it is at or under the low-stock level.
 * Also the inventory settings an inventory key may see: cost, usual supplier, order-up-to level, and the option label and group of a product that comes in options.
 */
export const GET = route("inventory:read", async (ctx, req) => {
  const p = pageParams(new URL(req.url));
  const b = ctx.business.id;
  const rows = await withTenant(b, (tx) => tx.select().from(schema.products).where(and(eq(schema.products.businessId, b), eq(schema.products.trackStock, true), eq(schema.products.active, true))).orderBy(asc(schema.products.name), asc(schema.products.variantLabel), asc(schema.products.id)).limit(p.limit).offset(p.offset));
  return list(rows.map((r) => ({
    product_id: r.id, name: r.name, sku: r.sku, barcode: r.barcode, kind: r.kind, on_hand: r.stockQty, low_stock_threshold: r.lowStockThreshold, is_low: r.stockQty <= r.lowStockThreshold,
    variant_label: r.variantLabel, group_id: r.groupId, reorder_up_to: r.reorderUpTo, supplier_id: r.supplierId, cost_cents: r.costCents,
  })), p);
});
