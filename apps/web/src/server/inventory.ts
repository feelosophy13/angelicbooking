/**
 * Retail inventory: on-hand quantity per tracked product, a movement ledger,
 * automatic decrement when a sale closes, low-stock flags and a stock report.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";

export class InventoryError extends Error {}

/** Inside the sale-closing transaction: subtract sold quantities (idempotent per sale/product). */
export async function decrementStockForSale(tx: TenantDb, businessId: string, saleId: string) {
  const lines = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), eq(schema.saleLines.kind, "product")));
  const byProduct = new Map<string, number>();
  for (const l of lines) if (l.productId) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.quantity);
  for (const [productId, qty] of byProduct) {
    const p = await tx.query.products.findFirst({ where: eq(schema.products.id, productId) });
    if (!p?.trackStock) continue;
    const inserted = await tx
      .insert(schema.stockMovements)
      .values({ businessId, productId, delta: -qty, reason: "sale", saleId, note: null })
      .onConflictDoNothing()
      .returning({ id: schema.stockMovements.id });
    if (inserted.length) await tx.update(schema.products).set({ stockQty: sql`${schema.products.stockQty} - ${qty}` }).where(eq(schema.products.id, productId));
  }
}

export async function recordMovement(input: { businessId: string; productId: string; delta: number; reason: "received" | "adjust" | "refund"; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const p = await tx.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
    if (!p) throw new InventoryError("Product not found.");
    if (p.stockQty + input.delta < 0) throw new InventoryError(`Only ${p.stockQty} in stock.`);
    await tx.insert(schema.stockMovements).values({ businessId: input.businessId, productId: input.productId, delta: input.delta, reason: input.reason, note: input.note, createdByUserId: input.actorUserId });
    await tx.update(schema.products).set({ stockQty: p.stockQty + input.delta, trackStock: true }).where(eq(schema.products.id, input.productId));
  });
}

export async function productMovements(businessId: string, productId: string, limit = 50) {
  return withTenant(businessId, (tx) => tx.select().from(schema.stockMovements).where(eq(schema.stockMovements.productId, productId)).orderBy(desc(schema.stockMovements.createdAt)).limit(limit));
}

/** Tracked products with on-hand quantity and value at cost; low-stock first. */
export async function stockReport(businessId: string) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ p: schema.products, category: schema.productCategories.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .where(and(eq(schema.products.trackStock, true), eq(schema.products.active, true)))
      .orderBy(asc(schema.products.name));
    const items = rows.map(({ p, category }) => ({ ...p, category, low: p.stockQty <= p.lowStockThreshold, valueCents: p.stockQty * p.costCents, retailCents: p.stockQty * p.priceCents }));
    return {
      items: [...items].sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name)),
      totalValueCents: items.reduce((s, i) => s + i.valueCents, 0),
      totalRetailCents: items.reduce((s, i) => s + i.retailCents, 0),
      lowCount: items.filter((i) => i.low).length,
    };
  });
}
