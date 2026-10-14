/**
 * Inventory: what is on the shelf at each location, every change to it (a ledger), and what to do about it:
 * sales and back-bar use take stock off, deliveries and counts put it right, purchase orders and reorder
 * suggestions say what to buy, and reports show what sells, what sits and what goes missing.
 *
 * Rules worth knowing:
 *  - `products.stock_qty` is always the sum of `product_stock` (one row per product per location); both change only through `applyMove`.
 *  - A sale never stops at the desk because the count is wrong: the count may go negative and shows as "count is off".
 *    By hand (a write-off, a transfer) stock can never go below zero.
 *  - A refund gives money back; it does not put goods back on the shelf. Returns are recorded on purpose (`returnToShelf`).
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { instantToISODate, isAction } from "@angelic/core";
import { queueOneOff } from "@/lib/notify";
import { lowStockEmail } from "@/lib/notify/templates";
import { appUrl } from "@/lib/stripe";
import { isManualReason, locationAlerts, manualDelta, productLabel, SHRINKAGE_REASONS, stockStatus, suggestedOrderQty, daysOfStock, worstStatus, type LocationAlert, type ManualReason, type ParsedProductRow, type StockStatus } from "@/lib/inventory";
import { ensureCategory } from "./categories";

export class InventoryError extends Error {}

type Product = typeof schema.products.$inferSelect;

async function audit(tx: TenantDb, businessId: string, actorUserId: string | null, action: string, entityId: string, diff?: unknown) {
  await tx.insert(schema.auditLog).values({ businessId, actorUserId, action, entity: "inventory", entityId, diff: diff === undefined ? null : JSON.stringify(diff) });
}

/** The location stock is counted at when none is named: the default one. */
export async function mainLocationId(tx: TenantDb): Promise<string> {
  const [l] = await tx.select({ id: schema.locations.id }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)).limit(1);
  if (!l) throw new InventoryError("This business has no location.");
  return l.id;
}

export async function listLocations(businessId: string) {
  return withTenant(businessId, (tx) => tx.select({ id: schema.locations.id, name: schema.locations.name, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)));
}

/** Where a sale's stock comes from: the location it was rung up at. */
export const saleStockLocation = async (tx: TenantDb, sale: { locationId: string | null }) => sale.locationId ?? (await mainLocationId(tx));

type Move = { businessId: string; productId: string; locationId: string; delta: number; reason: string; note?: string | null; saleId?: string | null; appointmentId?: string | null; purchaseOrderId?: string | null; actorUserId?: string | null };

/** The only way stock changes. Returns false when a sale had already taken this product off (closing twice is harmless). */
async function applyMove(tx: TenantDb, m: Move): Promise<boolean> {
  if (m.delta === 0) return false;
  const [cost] = await tx.select({ c: schema.products.costCents }).from(schema.products).where(eq(schema.products.id, m.productId));
  const inserted = await tx
    .insert(schema.stockMovements)
    .values({ businessId: m.businessId, productId: m.productId, locationId: m.locationId, delta: m.delta, reason: m.reason, note: m.note ?? null, saleId: m.saleId ?? null, appointmentId: m.appointmentId ?? null, purchaseOrderId: m.purchaseOrderId ?? null, unitCostCents: cost?.c ?? 0, createdByUserId: m.actorUserId ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.stockMovements.id });
  if (!inserted.length) return false;
  await tx
    .insert(schema.productStock)
    .values({ businessId: m.businessId, productId: m.productId, locationId: m.locationId, qty: m.delta })
    .onConflictDoUpdate({ target: [schema.productStock.productId, schema.productStock.locationId], set: { qty: sql`${schema.productStock.qty} + ${m.delta}` } });
  await tx.update(schema.products).set({ stockQty: sql`${schema.products.stockQty} + ${m.delta}` }).where(eq(schema.products.id, m.productId));
  return true;
}

/** On hand at one location (locked, so two people changing it at once queue up). */
async function qtyAt(tx: TenantDb, productId: string, locationId: string): Promise<number> {
  const [row] = await tx.select({ qty: schema.productStock.qty }).from(schema.productStock).where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, locationId))).for("update");
  return row?.qty ?? 0;
}

async function locationName(tx: TenantDb, id: string) {
  const [l] = await tx.select({ name: schema.locations.name }).from(schema.locations).where(eq(schema.locations.id, id));
  return l?.name ?? "another location";
}

// ---- Sales: stock out, back-bar use, returns ----

/** Inside the sale-closing transaction: take off what was sold and what the services used (once per sale). */
export async function decrementStockForSale(tx: TenantDb, businessId: string, saleId: string) {
  const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
  if (!sale) return;
  const locationId = await saleStockLocation(tx, sale);
  const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId));
  const sold = new Map<string, number>();
  for (const l of lines) if (l.kind === "product" && l.productId) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.quantity);
  const services = new Map<string, number>();
  for (const l of lines) if (l.kind === "service" && l.serviceId) services.set(l.serviceId, (services.get(l.serviceId) ?? 0) + Math.max(1, l.quantity));
  const used = new Map<string, number>();
  if (services.size) {
    const usage = await tx.select().from(schema.serviceProducts).where(and(inArray(schema.serviceProducts.serviceId, [...services.keys()]), eq(schema.serviceProducts.mode, "auto")));
    for (const u of usage) used.set(u.productId, (used.get(u.productId) ?? 0) + u.quantity * (services.get(u.serviceId) ?? 1));
  }
  const ids = [...new Set([...sold.keys(), ...used.keys()])];
  if (!ids.length) return;
  const tracked = new Set((await tx.select({ id: schema.products.id }).from(schema.products).where(and(inArray(schema.products.id, ids), eq(schema.products.trackStock, true)))).map((p) => p.id));
  for (const [productId, qty] of sold) if (tracked.has(productId)) await applyMove(tx, { businessId, productId, locationId, delta: -qty, reason: "sale", saleId });
  for (const [productId, qty] of used) if (tracked.has(productId)) await applyMove(tx, { businessId, productId, locationId, delta: -qty, reason: "used", saleId, note: `Used in services, sale #${sale.number}` });
}

/** What a sale took off the shelf and what has been put back, per product (for the "put back on the shelf" form). */
export async function saleStockState(businessId: string, saleId: string) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.select({ productId: schema.stockMovements.productId, reason: schema.stockMovements.reason, qty: sql<number>`sum(${schema.stockMovements.delta})` }).from(schema.stockMovements).where(and(eq(schema.stockMovements.saleId, saleId), inArray(schema.stockMovements.reason, ["sale", "return"]))).groupBy(schema.stockMovements.productId, schema.stockMovements.reason);
    const out = new Map<string, { sold: number; returned: number }>();
    for (const r of rows) {
      const cur = out.get(r.productId) ?? { sold: 0, returned: 0 };
      if (r.reason === "sale") cur.sold = -Number(r.qty);
      else cur.returned = Number(r.qty);
      out.set(r.productId, cur);
    }
    return out;
  });
}

/** Put goods a client brought back on the shelf. Only for products the sale took off the shelf, and never more than it did. */
export async function returnToShelf(input: { businessId: string; saleId: string; items: { productId: string; qty: number }[]; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new InventoryError("Sale not found.");
    if (sale.status !== "paid" && sale.status !== "refunded") throw new InventoryError("Only a completed sale can have goods returned.");
    const locationId = await saleStockLocation(tx, sale);
    const state = await tx.select({ productId: schema.stockMovements.productId, reason: schema.stockMovements.reason, qty: sql<number>`sum(${schema.stockMovements.delta})` }).from(schema.stockMovements).where(and(eq(schema.stockMovements.saleId, sale.id), inArray(schema.stockMovements.reason, ["sale", "return"]))).groupBy(schema.stockMovements.productId, schema.stockMovements.reason);
    let moved = 0;
    for (const it of input.items) {
      const qty = Math.floor(it.qty);
      if (qty <= 0) continue;
      const sold = -Number(state.find((s) => s.productId === it.productId && s.reason === "sale")?.qty ?? 0);
      const returned = Number(state.find((s) => s.productId === it.productId && s.reason === "return")?.qty ?? 0);
      if (sold <= 0) throw new InventoryError("That product wasn't counted in stock when it was sold.");
      if (qty > sold - returned) throw new InventoryError(sold - returned <= 0 ? "Those are already back on the shelf." : `Only ${sold - returned} can still be put back.`);
      await applyMove(tx, { businessId: input.businessId, productId: it.productId, locationId, delta: qty, reason: "return", saleId: sale.id, note: input.note ? `${input.note} (sale #${sale.number})` : `Returned, sale #${sale.number}`, actorUserId: input.actorUserId });
      moved += qty;
    }
    if (!moved) throw new InventoryError("Choose how many to put back.");
    await audit(tx, input.businessId, input.actorUserId, "inventory.return_to_shelf", sale.id, { items: input.items });
  });
}

// ---- By hand: receive, adjust, write off, transfer, count ----

export async function recordMovement(input: { businessId: string; productId: string; locationId?: string | null; entered: number; reason: ManualReason; note: string | null; actorUserId: string }) {
  if (!isManualReason(input.reason)) throw new InventoryError("Unknown reason.");
  const delta = manualDelta(input.reason, Math.round(input.entered));
  if (delta === 0) throw new InventoryError("Enter how many units.");
  await withTenant(input.businessId, async (tx) => {
    const p = await tx.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
    if (!p) throw new InventoryError("Product not found.");
    const locationId = input.locationId || (await mainLocationId(tx));
    const have = await qtyAt(tx, p.id, locationId);
    if (delta < 0 && have + delta < 0) throw new InventoryError(have <= 0 ? "Nothing is counted at this location to take off. Count it first." : `Only ${have} counted here.`);
    await applyMove(tx, { businessId: input.businessId, productId: p.id, locationId, delta, reason: input.reason, note: input.note, actorUserId: input.actorUserId });
    if (!p.trackStock) await tx.update(schema.products).set({ trackStock: true }).where(eq(schema.products.id, p.id));
  });
}

/** Move units between two locations: the total does not change. */
export async function transferStock(input: { businessId: string; productId: string; fromLocationId: string; toLocationId: string; qty: number; note: string | null; actorUserId: string }) {
  const qty = Math.floor(input.qty);
  if (qty <= 0) throw new InventoryError("Enter how many units to move.");
  if (input.fromLocationId === input.toLocationId) throw new InventoryError("Pick two different locations.");
  await withTenant(input.businessId, async (tx) => {
    const have = await qtyAt(tx, input.productId, input.fromLocationId);
    if (have < qty) throw new InventoryError(`Only ${have} at ${await locationName(tx, input.fromLocationId)}.`);
    const [from, to] = [await locationName(tx, input.fromLocationId), await locationName(tx, input.toLocationId)];
    await applyMove(tx, { businessId: input.businessId, productId: input.productId, locationId: input.fromLocationId, delta: -qty, reason: "transfer_out", note: `To ${to}${input.note ? ` · ${input.note}` : ""}`, actorUserId: input.actorUserId });
    await applyMove(tx, { businessId: input.businessId, productId: input.productId, locationId: input.toLocationId, delta: qty, reason: "transfer_in", note: `From ${from}${input.note ? ` · ${input.note}` : ""}`, actorUserId: input.actorUserId });
  });
}

/** Set the count from what was physically counted: only products whose count differs get a movement. */
export async function applyCount(input: { businessId: string; locationId: string; counts: { productId: string; counted: number }[]; note: string | null; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    let changed = 0;
    let unitsOff = 0;
    for (const c of input.counts) {
      if (!Number.isInteger(c.counted) || c.counted < 0) continue;
      const have = await qtyAt(tx, c.productId, input.locationId);
      if (have === c.counted) continue;
      await applyMove(tx, { businessId: input.businessId, productId: c.productId, locationId: input.locationId, delta: c.counted - have, reason: "count", note: `Counted ${c.counted}, was ${have}${input.note ? ` · ${input.note}` : ""}`, actorUserId: input.actorUserId });
      await tx.update(schema.products).set({ trackStock: true }).where(and(eq(schema.products.id, c.productId), eq(schema.products.trackStock, false)));
      changed++;
      unitsOff += Math.abs(c.counted - have);
    }
    await audit(tx, input.businessId, input.actorUserId, "inventory.count", input.locationId, { counted: input.counts.length, changed, unitsOff });
    return { counted: input.counts.length, changed, unitsOff };
  });
}

export async function productMovements(businessId: string, productId: string, limit = 50) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ m: schema.stockMovements, location: schema.locations.name, who: schema.user.name })
      .from(schema.stockMovements)
      .leftJoin(schema.locations, eq(schema.locations.id, schema.stockMovements.locationId))
      .leftJoin(schema.user, eq(schema.user.id, schema.stockMovements.createdByUserId))
      .where(eq(schema.stockMovements.productId, productId))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.m, location: r.location, who: r.who }));
  });
}

export async function stockByLocation(businessId: string, productId: string) {
  return withTenant(businessId, (tx) =>
    tx.select({ locationId: schema.productStock.locationId, name: schema.locations.name, qty: schema.productStock.qty }).from(schema.productStock).innerJoin(schema.locations, eq(schema.locations.id, schema.productStock.locationId)).where(eq(schema.productStock.productId, productId)).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)),
  );
}

/** On hand per product at one location (for the register's "only N in stock" note). */
export async function stockLevels(tx: TenantDb, locationId: string, productIds: string[]) {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  const rows = await tx.select({ productId: schema.productStock.productId, qty: schema.productStock.qty }).from(schema.productStock).where(and(eq(schema.productStock.locationId, locationId), inArray(schema.productStock.productId, productIds)));
  for (const r of rows) out.set(r.productId, r.qty);
  return out;
}

/** The product a scanner or typed code points at: barcode first, then SKU. */
export async function findProductByCode(businessId: string, code: string) {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  return withTenant(businessId, async (tx) => {
    const rows = await tx.select().from(schema.products).where(and(eq(schema.products.active, true), sql`(lower(${schema.products.barcode}) = ${c} or lower(${schema.products.sku}) = ${c})`));
    return rows.find((p) => p.barcode?.toLowerCase() === c) ?? rows[0] ?? null;
  });
}

// ---- Online orders: don't sell what is already spoken for ----

/** Online carts held open this long count against the shelf, so two buyers can't both take the last one. */
export const ONLINE_HOLD_MINUTES = 30;

/** For each product: what the online store may still sell (on hand at that location, less unpaid online orders). Untracked products are absent. */
export async function onlineAvailability(tx: TenantDb, locationId: string | null, productIds: string[], opts: { lock?: boolean } = {}) {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  const loc = locationId ?? (await mainLocationId(tx));
  const tracked = await tx.select({ id: schema.products.id }).from(schema.products).where(and(inArray(schema.products.id, productIds), eq(schema.products.trackStock, true)));
  if (!tracked.length) return out;
  const ids = tracked.map((t) => t.id);
  // When an order is being placed, lock the products so concurrent orders for the same one queue up behind each other.
  if (opts.lock) await tx.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.id, ids)).for("update");
  const have = await stockLevels(tx, loc, ids);
  const since = new Date(Date.now() - ONLINE_HOLD_MINUTES * 60_000);
  const held = await tx
    .select({ productId: schema.saleLines.productId, qty: sql<number>`sum(${schema.saleLines.quantity})` })
    .from(schema.saleLines)
    .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
    .where(and(eq(schema.sales.status, "open"), eq(schema.sales.source, "online"), gte(schema.sales.createdAt, since), inArray(schema.saleLines.productId, ids), locationId ? eq(schema.sales.locationId, locationId) : sql`true`))
    .groupBy(schema.saleLines.productId);
  const holds = new Map(held.map((h) => [h.productId!, Number(h.qty)]));
  for (const id of ids) out.set(id, Math.max(0, (have.get(id) ?? 0) - (holds.get(id) ?? 0)));
  return out;
}

// ---- Overview, low stock, reorder ----

/** Units still on the way: per product, and per product at the location the order is for (an order with no location is for the main one). */
async function onOrderMap(tx: TenantDb, mainId: string): Promise<{ total: Map<string, number>; at: Map<string, number> }> {
  const rows = await tx
    .select({ productId: schema.purchaseOrderLines.productId, locationId: schema.purchaseOrders.locationId, qty: sql<number>`sum(greatest(0, ${schema.purchaseOrderLines.orderedQty} - ${schema.purchaseOrderLines.receivedQty}))` })
    .from(schema.purchaseOrderLines)
    .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrders.id, schema.purchaseOrderLines.purchaseOrderId))
    .where(inArray(schema.purchaseOrders.status, ["ordered", "partial"]))
    .groupBy(schema.purchaseOrderLines.productId, schema.purchaseOrders.locationId);
  const total = new Map<string, number>();
  const at = new Map<string, number>();
  for (const r of rows) {
    const q = Number(r.qty);
    total.set(r.productId, (total.get(r.productId) ?? 0) + q);
    const key = `${r.productId}|${r.locationId ?? mainId}`;
    at.set(key, (at.get(key) ?? 0) + q);
  }
  return { total, at };
}

export type StockItem = Product & {
  category: string | null;
  supplierName: string | null;
  byLocation: Record<string, number>;
  onOrder: number;
  /** The worst standing at any location (each location is judged on its own count). */
  status: StockStatus;
  /** Where it needs attention, worst first. */
  alerts: LocationAlert[];
  valueCents: number;
  retailCents: number;
};

/** How recently a location must have sold or used a product for an empty shelf to count as a problem there. */
const RECENT_DAYS = 90;

/** Every tracked, active product with its count (in total and per location), what is on order and where it needs attention. */
export async function stockOverview(businessId: string): Promise<{ items: StockItem[]; untracked: number }> {
  return withTenant(businessId, async (tx) => {
    const mainId = await mainLocationId(tx);
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const [rows, levels, onOrder, all, moved, locs] = await Promise.all([
      tx
        .select({ p: schema.products, category: schema.productCategories.name, supplierName: schema.suppliers.name })
        .from(schema.products)
        .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
        .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.products.supplierId))
        .where(and(eq(schema.products.trackStock, true), eq(schema.products.active, true)))
        .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel)),
      tx.select().from(schema.productStock),
      onOrderMap(tx, mainId),
      tx.select({ n: sql<number>`count(*)` }).from(schema.products).where(and(eq(schema.products.trackStock, false), eq(schema.products.active, true))),
      tx.selectDistinct({ productId: schema.stockMovements.productId, locationId: schema.stockMovements.locationId }).from(schema.stockMovements).where(and(inArray(schema.stockMovements.reason, ["sale", "used"]), gte(schema.stockMovements.createdAt, since))),
      tx.select({ id: schema.locations.id }).from(schema.locations),
    ]);
    const multiLocation = locs.length > 1;
    const recent = new Set(moved.map((m) => `${m.productId}|${m.locationId}`));
    const by = new Map<string, Record<string, number>>();
    for (const l of levels) by.set(l.productId, { ...(by.get(l.productId) ?? {}), [l.locationId]: l.qty });
    const items = rows.map(({ p, category, supplierName }) => {
      const byLocation = by.get(p.id) ?? {};
      // A tracked product that has never been counted anywhere is judged at the main location.
      const entries = Object.keys(byLocation).length ? Object.entries(byLocation) : [[mainId, p.stockQty] as [string, number]];
      const alerts = locationAlerts({ threshold: p.lowStockThreshold, multiLocation, rows: entries.map(([locationId, qty]) => ({ locationId, qty, onOrder: onOrder.at.get(`${p.id}|${locationId}`) ?? 0, recentlyMoved: recent.has(`${p.id}|${locationId}`) })) });
      return {
        ...p,
        category,
        supplierName,
        byLocation,
        onOrder: onOrder.total.get(p.id) ?? 0,
        status: worstStatus(alerts.map((a) => a.status)),
        alerts,
        valueCents: p.stockQty * p.costCents,
        retailCents: p.kind === "retail" ? p.stockQty * p.priceCents : 0,
      };
    });
    return { items, untracked: Number(all[0]?.n ?? 0) };
  });
}

/**
 * How many tracked products need attention at some location: one cheap query for the sidebar badge. It repeats the rule in
 * `locationAlerts` (the integration check compares the two).
 */
export async function lowStockCount(businessId: string): Promise<number> {
  return withTenant(businessId, async (tx) => {
    const [r] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from products p
      where p.track_stock and p.active and (
        case when (select count(*) from locations) > 1 then
          exists (
            select 1 from product_stock ps where ps.product_id = p.id and (
              ps.qty < 0
              or (ps.qty > 0 and ps.qty <= p.low_stock_threshold)
              or (ps.qty = 0 and (
                exists (select 1 from stock_movements m where m.product_id = p.id and m.location_id = ps.location_id and m.reason in ('sale','used') and m.created_at >= now() - interval '${sql.raw(String(RECENT_DAYS))} days')
                or exists (select 1 from purchase_order_lines l join purchase_orders o on o.id = l.purchase_order_id where l.product_id = p.id and o.status in ('ordered','partial') and l.ordered_qty > l.received_qty and coalesce(o.location_id, (select id from locations order by is_default desc, name limit 1)) = ps.location_id)
              ))
            )
          )
          or (not exists (select 1 from product_stock ps where ps.product_id = p.id) and p.stock_qty <= p.low_stock_threshold)
        else p.stock_qty <= p.low_stock_threshold end
      )`);
    return Number(r?.n ?? 0);
  });
}

/** Products that need someone to look at them: out, low, or with a count that is off, at any location. Worst first. */
export async function lowStock(businessId: string) {
  const { items } = await stockOverview(businessId);
  return items.filter((i) => i.status !== "ok").sort((a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] || a.name.localeCompare(b.name));
}
const SEVERITY_ORDER: Record<StockStatus, number> = { negative: 0, out: 1, low: 2, ok: 3 };

export type ReorderGroup = {
  supplierId: string | null;
  supplierName: string;
  /** The location these are for: each location's shortfall is its own order (it is delivered there). */
  locationId: string;
  locationName: string;
  items: { productId: string; name: string; onHand: number; onOrder: number; threshold: number; qty: number; unitCostCents: number }[];
};

/**
 * What to order: for each location, what has fallen to its low-stock level, brought back up to the product's "order up to" level,
 * grouped by supplier. What is already on its way to that location counts as stock.
 */
export async function reorderSuggestions(businessId: string): Promise<ReorderGroup[]> {
  const [{ items }, locations] = await Promise.all([stockOverview(businessId), listLocations(businessId)]);
  const groups = new Map<string, ReorderGroup>();
  for (const i of items) {
    for (const a of i.alerts) {
      const qty = suggestedOrderQty({ onHand: a.qty, onOrder: a.onOrder, threshold: i.lowStockThreshold, reorderUpTo: i.reorderUpTo });
      if (qty <= 0) continue;
      const key = `${i.supplierId ?? "none"}|${a.locationId}`;
      const g = groups.get(key) ?? { supplierId: i.supplierId, supplierName: i.supplierName ?? "No supplier set", locationId: a.locationId, locationName: locations.find((l) => l.id === a.locationId)?.name ?? "", items: [] };
      g.items.push({ productId: i.id, name: productLabel(i), onHand: a.qty, onOrder: a.onOrder, threshold: i.lowStockThreshold, qty, unitCostCents: i.costCents });
      groups.set(key, g);
    }
  }
  const rank = new Map(locations.map((l, n) => [l.id, n]));
  return [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || a.supplierName.localeCompare(b.supplierName) || (rank.get(a.locationId) ?? 0) - (rank.get(b.locationId) ?? 0));
}

// ---- Suppliers and purchase orders ----

export async function listSuppliers(businessId: string, opts: { includeInactive?: boolean } = {}) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ s: schema.suppliers, products: sql<number>`(select count(*) from products p where p.supplier_id = suppliers.id and p.active)` })
      .from(schema.suppliers)
      .where(opts.includeInactive ? sql`true` : eq(schema.suppliers.active, true))
      .orderBy(asc(schema.suppliers.name));
    return rows.map((r) => ({ ...r.s, products: Number(r.products) }));
  });
}

export async function getSupplier(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id) }));
}

export type PurchaseOrder = typeof schema.purchaseOrders.$inferSelect;

export async function listPurchaseOrders(businessId: string, filter: "open" | "received" | "all" = "open") {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({
        po: schema.purchaseOrders,
        supplier: schema.suppliers.name,
        location: schema.locations.name,
        units: sql<number>`coalesce((select sum(l.ordered_qty) from purchase_order_lines l where l.purchase_order_id = ${schema.purchaseOrders.id}), 0)`,
        received: sql<number>`coalesce((select sum(l.received_qty) from purchase_order_lines l where l.purchase_order_id = ${schema.purchaseOrders.id}), 0)`,
        costCents: sql<number>`coalesce((select sum(l.ordered_qty * l.unit_cost_cents) from purchase_order_lines l where l.purchase_order_id = ${schema.purchaseOrders.id}), 0)`,
      })
      .from(schema.purchaseOrders)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.purchaseOrders.locationId))
      .where(filter === "open" ? inArray(schema.purchaseOrders.status, ["draft", "ordered", "partial"]) : filter === "received" ? inArray(schema.purchaseOrders.status, ["received", "cancelled"]) : sql`true`)
      .orderBy(desc(schema.purchaseOrders.number));
    return rows.map((r) => ({ ...r.po, supplier: r.supplier, location: r.location, units: Number(r.units), receivedUnits: Number(r.received), costCents: Number(r.costCents) }));
  });
}

export async function getPurchaseOrder(businessId: string, id: string) {
  return withTenant(businessId, async (tx) => {
    const po = await tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, id) });
    if (!po) return null;
    const [lines, supplier, location] = await Promise.all([
      tx
        .select({ l: schema.purchaseOrderLines, name: schema.products.name, variantLabel: schema.products.variantLabel, sku: schema.products.sku, barcode: schema.products.barcode })
        .from(schema.purchaseOrderLines)
        .innerJoin(schema.products, eq(schema.products.id, schema.purchaseOrderLines.productId))
        .where(eq(schema.purchaseOrderLines.purchaseOrderId, id))
        .orderBy(asc(schema.products.name), asc(schema.products.variantLabel)),
      po.supplierId ? tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, po.supplierId) }) : Promise.resolve(null),
      po.locationId ? tx.query.locations.findFirst({ where: eq(schema.locations.id, po.locationId) }) : Promise.resolve(null),
    ]);
    return { po, supplier: supplier ?? null, location: location ?? null, lines: lines.map((r) => ({ ...r.l, label: productLabel({ name: r.name, variantLabel: r.variantLabel }), sku: r.sku, barcode: r.barcode })) };
  });
}

export async function createPurchaseOrder(input: { businessId: string; supplierId: string | null; locationId?: string | null; expectedOn?: string | null; notes?: string | null; lines?: { productId: string; qty: number; unitCostCents?: number }[]; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    const locationId = input.locationId || (await mainLocationId(tx));
    const rows = await tx.execute<{ n: number }>(sql`select next_purchase_order_number(${input.businessId}) as n`);
    const [po] = await tx.insert(schema.purchaseOrders).values({ businessId: input.businessId, number: Number(rows[0]?.n ?? 1), supplierId: input.supplierId, locationId, expectedOn: input.expectedOn ?? null, notes: input.notes ?? null, createdByUserId: input.actorUserId }).returning();
    if (input.lines?.length) {
      const prods = await tx.select({ id: schema.products.id, cost: schema.products.costCents }).from(schema.products).where(inArray(schema.products.id, input.lines.map((l) => l.productId)));
      const cost = new Map(prods.map((p) => [p.id, p.cost]));
      await tx.insert(schema.purchaseOrderLines).values(input.lines.filter((l) => cost.has(l.productId) && l.qty > 0).map((l) => ({ businessId: input.businessId, purchaseOrderId: po!.id, productId: l.productId, orderedQty: Math.floor(l.qty), unitCostCents: l.unitCostCents ?? cost.get(l.productId) ?? 0 })));
    }
    await audit(tx, input.businessId, input.actorUserId, "inventory.po_create", po!.id, { number: po!.number });
    return po!;
  });
}

async function openPo(tx: TenantDb, id: string, allowed: PurchaseOrder["status"][]) {
  const po = await tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, id) });
  if (!po) throw new InventoryError("Order not found.");
  if (!allowed.includes(po.status)) throw new InventoryError(`This order is ${po.status}.`);
  return po;
}

export async function updatePurchaseOrder(input: { businessId: string; id: string; supplierId: string | null; locationId: string | null; expectedOn: string | null; notes: string | null; reference: string | null }) {
  await withTenant(input.businessId, async (tx) => {
    await openPo(tx, input.id, ["draft", "ordered", "partial"]);
    await tx.update(schema.purchaseOrders).set({ supplierId: input.supplierId, locationId: input.locationId, expectedOn: input.expectedOn, notes: input.notes, reference: input.reference }).where(eq(schema.purchaseOrders.id, input.id));
  });
}

/** Add a product to a draft/ordered order, or change its quantity and unit cost. A quantity of 0 removes it. */
export async function setPoLine(input: { businessId: string; id: string; productId: string; qty: number; unitCostCents?: number | null }) {
  await withTenant(input.businessId, async (tx) => {
    await openPo(tx, input.id, ["draft", "ordered", "partial"]);
    const qty = Math.floor(input.qty);
    if (qty <= 0) {
      await tx.delete(schema.purchaseOrderLines).where(and(eq(schema.purchaseOrderLines.purchaseOrderId, input.id), eq(schema.purchaseOrderLines.productId, input.productId), eq(schema.purchaseOrderLines.receivedQty, 0)));
      return;
    }
    const p = await tx.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
    if (!p) throw new InventoryError("Product not found.");
    const cost = input.unitCostCents ?? p.costCents;
    await tx
      .insert(schema.purchaseOrderLines)
      .values({ businessId: input.businessId, purchaseOrderId: input.id, productId: p.id, orderedQty: qty, unitCostCents: cost })
      .onConflictDoUpdate({ target: [schema.purchaseOrderLines.purchaseOrderId, schema.purchaseOrderLines.productId], set: { orderedQty: qty, unitCostCents: cost } });
  });
}

export async function markOrdered(input: { businessId: string; id: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    await openPo(tx, input.id, ["draft"]);
    const [n] = await tx.select({ n: sql<number>`count(*)` }).from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, input.id));
    if (!Number(n?.n)) throw new InventoryError("Add at least one product first.");
    await tx.update(schema.purchaseOrders).set({ status: "ordered", orderedAt: new Date() }).where(eq(schema.purchaseOrders.id, input.id));
    await audit(tx, input.businessId, input.actorUserId, "inventory.po_ordered", input.id);
  });
}

/** Take delivery of all or part of an order: adds the stock, updates each product's cost to what was paid, and closes the order when everything has arrived. */
export async function receiveOrder(input: { businessId: string; id: string; lines: { lineId: string; qty: number; unitCostCents?: number | null }[]; reference?: string | null; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    const po = await openPo(tx, input.id, ["draft", "ordered", "partial"]);
    const locationId = po.locationId ?? (await mainLocationId(tx));
    const lines = await tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id));
    let units = 0;
    for (const it of input.lines) {
      const line = lines.find((l) => l.id === it.lineId);
      const qty = Math.floor(it.qty);
      if (!line || qty <= 0) continue;
      const cost = it.unitCostCents ?? line.unitCostCents;
      await applyMove(tx, { businessId: input.businessId, productId: line.productId, locationId, delta: qty, reason: "received", purchaseOrderId: po.id, note: `Order #${po.number}`, actorUserId: input.actorUserId });
      await tx.update(schema.purchaseOrderLines).set({ receivedQty: sql`${schema.purchaseOrderLines.receivedQty} + ${qty}`, unitCostCents: cost }).where(eq(schema.purchaseOrderLines.id, line.id));
      await tx.update(schema.products).set({ trackStock: true, ...(cost > 0 ? { costCents: cost } : {}) }).where(eq(schema.products.id, line.productId));
      units += qty;
    }
    if (!units) throw new InventoryError("Enter how many arrived.");
    const after = await tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id));
    const done = after.every((l) => l.receivedQty >= l.orderedQty);
    await tx.update(schema.purchaseOrders).set({ status: done ? "received" : "partial", receivedAt: done ? new Date() : null, orderedAt: po.orderedAt ?? new Date(), ...(input.reference ? { reference: input.reference } : {}) }).where(eq(schema.purchaseOrders.id, po.id));
    await audit(tx, input.businessId, input.actorUserId, "inventory.po_received", po.id, { units, done });
    return { units, done };
  });
}

export async function cancelOrder(input: { businessId: string; id: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    await openPo(tx, input.id, ["draft", "ordered", "partial"]);
    await tx.update(schema.purchaseOrders).set({ status: "cancelled" }).where(eq(schema.purchaseOrders.id, input.id));
    await audit(tx, input.businessId, input.actorUserId, "inventory.po_cancelled", input.id);
  });
}

// ---- Back-bar use ----

export async function serviceUsage(businessId: string, serviceId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.serviceProducts.id, productId: schema.serviceProducts.productId, quantity: schema.serviceProducts.quantity, mode: schema.serviceProducts.mode, kind: schema.products.kind, name: schema.products.name, variantLabel: schema.products.variantLabel })
      .from(schema.serviceProducts)
      .innerJoin(schema.products, eq(schema.products.id, schema.serviceProducts.productId))
      .where(eq(schema.serviceProducts.serviceId, serviceId))
      .orderBy(asc(schema.products.name)),
  );
}

export async function setServiceUsage(input: { businessId: string; serviceId: string; productId: string; quantity: number; mode?: "auto" | "log" }) {
  await withTenant(input.businessId, async (tx) => {
    const qty = Math.floor(input.quantity);
    if (qty <= 0) {
      await tx.delete(schema.serviceProducts).where(and(eq(schema.serviceProducts.serviceId, input.serviceId), eq(schema.serviceProducts.productId, input.productId)));
      return;
    }
    const mode = input.mode ?? "auto";
    await tx.insert(schema.serviceProducts).values({ businessId: input.businessId, serviceId: input.serviceId, productId: input.productId, quantity: qty, mode }).onConflictDoUpdate({ target: [schema.serviceProducts.serviceId, schema.serviceProducts.productId], set: input.mode ? { quantity: qty, mode } : { quantity: qty } });
    await tx.update(schema.products).set({ trackStock: true }).where(eq(schema.products.id, input.productId));
  });
}


/** Give other services the same list of products used. By default it adds what they lack and keeps what they have; `replace` makes their lists the same. */
export async function copyServiceUsage(input: { businessId: string; fromServiceId: string; toServiceIds: string[]; replace: boolean }) {
  return withTenant(input.businessId, async (tx) => {
    const source = await tx.select().from(schema.serviceProducts).where(eq(schema.serviceProducts.serviceId, input.fromServiceId));
    if (!source.length) throw new InventoryError("This service doesn't use any products yet.");
    const targets = [...new Set(input.toServiceIds)].filter((id) => id !== input.fromServiceId);
    if (!targets.length) throw new InventoryError("Choose at least one service to copy to.");
    const found = await tx.select({ id: schema.services.id }).from(schema.services).where(inArray(schema.services.id, targets));
    for (const { id } of found) {
      if (input.replace) await tx.delete(schema.serviceProducts).where(eq(schema.serviceProducts.serviceId, id));
      await tx.insert(schema.serviceProducts).values(source.map((r) => ({ businessId: input.businessId, serviceId: id, productId: r.productId, quantity: r.quantity, mode: r.mode }))).onConflictDoNothing();
    }
    return found.length;
  });
}

/** The services that use a product up, for the hint on the product's page. */
export async function productUsage(businessId: string, productId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ serviceId: schema.serviceProducts.serviceId, name: schema.services.name, quantity: schema.serviceProducts.quantity, mode: schema.serviceProducts.mode })
      .from(schema.serviceProducts)
      .innerJoin(schema.services, eq(schema.services.id, schema.serviceProducts.serviceId))
      .where(eq(schema.serviceProducts.productId, productId))
      .orderBy(asc(schema.services.name)),
  );
}

// ---- Supplies used on a visit, logged by staff ----

/**
 * Staff say what they really used (a fraction of a tube is a whole unit once it is finished, not a guess per visit).
 * Goes against the visit's location; may take the count below zero (never stop work mid-service), which then shows as "count is off".
 */
export async function logUsage(input: { businessId: string; appointmentId?: string | null; locationId?: string | null; items: { productId: string; qty: number }[]; note: string | null; actorUserId: string }) {
  const items = input.items.map((i) => ({ productId: i.productId, qty: Math.floor(i.qty) })).filter((i) => i.qty > 0);
  if (!items.length) throw new InventoryError("Enter how many units were used.");
  return withTenant(input.businessId, async (tx) => {
    let locationId = input.locationId ?? null;
    if (input.appointmentId) {
      const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId), columns: { locationId: true } });
      if (!appt) throw new InventoryError("Appointment not found.");
      locationId = appt.locationId ?? locationId;
    }
    locationId = locationId ?? (await mainLocationId(tx));
    const prods = await tx.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.id, items.map((i) => i.productId)));
    if (prods.length !== new Set(items.map((i) => i.productId)).size) throw new InventoryError("Product not found.");
    for (const it of items) {
      await applyMove(tx, { businessId: input.businessId, productId: it.productId, locationId, delta: -it.qty, reason: "used", appointmentId: input.appointmentId ?? null, note: input.note ?? "Logged by staff", actorUserId: input.actorUserId });
      await tx.update(schema.products).set({ trackStock: true }).where(and(eq(schema.products.id, it.productId), eq(schema.products.trackStock, false)));
    }
    await audit(tx, input.businessId, input.actorUserId, "inventory.log_usage", input.appointmentId ?? locationId, { items });
    return items.reduce((s, i) => s + i.qty, 0);
  });
}

/** Take back supplies logged by mistake: puts units back (never more than were logged on that visit). */
export async function undoUsage(input: { businessId: string; appointmentId: string; productId: string; qty: number; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const [row] = await tx
      .select({ net: sql<number>`coalesce(sum(${schema.stockMovements.delta}), 0)`, loc: sql<string | null>`(array_agg(${schema.stockMovements.locationId} order by ${schema.stockMovements.createdAt} desc))[1]` })
      .from(schema.stockMovements)
      .where(and(eq(schema.stockMovements.appointmentId, input.appointmentId), eq(schema.stockMovements.productId, input.productId), eq(schema.stockMovements.reason, "used")));
    const logged = -Number(row?.net ?? 0);
    const qty = Math.floor(input.qty);
    if (qty <= 0 || qty > logged) throw new InventoryError(logged <= 0 ? "Nothing is logged for this product on this visit." : `Only ${logged} logged.`);
    await applyMove(tx, { businessId: input.businessId, productId: input.productId, locationId: row!.loc ?? (await mainLocationId(tx)), delta: qty, reason: "used", appointmentId: input.appointmentId, note: "Logged by mistake, taken back", actorUserId: input.actorUserId });
  });
}

/** What staff have logged on a visit (net of anything taken back), and what the visit's services suggest. */
export async function visitSupplies(businessId: string, appointmentId: string) {
  return withTenant(businessId, async (tx) => {
    const logged = await tx
      .select({ productId: schema.stockMovements.productId, name: schema.products.name, variantLabel: schema.products.variantLabel, net: sql<number>`-sum(${schema.stockMovements.delta})` })
      .from(schema.stockMovements)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockMovements.productId))
      .where(and(eq(schema.stockMovements.appointmentId, appointmentId), eq(schema.stockMovements.reason, "used")))
      .groupBy(schema.stockMovements.productId, schema.products.name, schema.products.variantLabel);
    const items = await tx.select({ serviceId: schema.appointmentItems.serviceId }).from(schema.appointmentItems).where(and(eq(schema.appointmentItems.appointmentId, appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
    const ids = [...new Set(items.map((i) => i.serviceId).filter((x): x is string => !!x))];
    const uses = ids.length
      ? await tx
          .select({ productId: schema.serviceProducts.productId, quantity: schema.serviceProducts.quantity, mode: schema.serviceProducts.mode, name: schema.products.name, variantLabel: schema.products.variantLabel })
          .from(schema.serviceProducts)
          .innerJoin(schema.products, eq(schema.products.id, schema.serviceProducts.productId))
          .where(inArray(schema.serviceProducts.serviceId, ids))
      : [];
    const suggest = new Map<string, { productId: string; label: string; qty: number }>();
    for (const u of uses.filter((x) => x.mode === "log")) {
      const cur = suggest.get(u.productId);
      suggest.set(u.productId, { productId: u.productId, label: productLabel(u), qty: (cur?.qty ?? 0) + u.quantity });
    }
    const automatic = [...new Map(uses.filter((x) => x.mode === "auto").map((u) => [u.productId, productLabel(u)])).values()];
    return {
      logged: logged.filter((l) => Number(l.net) > 0).map((l) => ({ productId: l.productId, label: productLabel(l), qty: Number(l.net) })),
      suggested: [...suggest.values()],
      automatic,
    };
  });
}

/** Products a person may log use of: every active tracked product, back-bar first. */
export async function loggableProducts(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel, kind: schema.products.kind })
      .from(schema.products)
      .where(eq(schema.products.active, true))
      .orderBy(asc(schema.products.kind), asc(schema.products.name), asc(schema.products.variantLabel)),
  );
}

/** Recent logged usage anywhere (for the Log usage page), newest first. */
export async function recentUsage(businessId: string, limit = 25) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ m: schema.stockMovements, name: schema.products.name, variantLabel: schema.products.variantLabel, location: schema.locations.name, who: schema.user.name })
      .from(schema.stockMovements)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockMovements.productId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.stockMovements.locationId))
      .leftJoin(schema.user, eq(schema.user.id, schema.stockMovements.createdByUserId))
      .where(and(eq(schema.stockMovements.reason, "used"), sql`${schema.stockMovements.createdByUserId} is not null`))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.m, label: productLabel(r), location: r.location, who: r.who }));
  });
}

// ---- Reports ----

export type InventoryReport = Awaited<ReturnType<typeof inventoryReport>>;

/** How stock behaved over the last `days`: pace and days left per product, what has not sold, what went missing, and the value on the shelf month by month. */
export async function inventoryReport(businessId: string, days = 90) {
  return withTenant(businessId, async (tx) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const products = await tx.select().from(schema.products).where(and(eq(schema.products.trackStock, true), eq(schema.products.active, true)));
    const moves = await tx
      .select({ productId: schema.stockMovements.productId, reason: schema.stockMovements.reason, qty: sql<number>`sum(${schema.stockMovements.delta})`, last: sql<Date | null>`max(${schema.stockMovements.createdAt})` })
      .from(schema.stockMovements)
      .where(gte(schema.stockMovements.createdAt, since))
      .groupBy(schema.stockMovements.productId, schema.stockMovements.reason);
    const lastSold = await tx
      .select({ productId: schema.stockMovements.productId, last: sql<Date>`max(${schema.stockMovements.createdAt})` })
      .from(schema.stockMovements)
      .where(inArray(schema.stockMovements.reason, ["sale", "used"]))
      .groupBy(schema.stockMovements.productId);
    const lastBy = new Map(lastSold.map((l) => [l.productId, l.last]));
    const net = (id: string, reasons: readonly string[]) => moves.filter((m) => m.productId === id && reasons.includes(m.reason)).reduce((s, m) => s + Number(m.qty), 0);

    const rows = products.map((p) => {
      const sold = -net(p.id, ["sale"]) + net(p.id, ["return"]);
      const used = -net(p.id, ["used"]);
      const moved = sold + used;
      return { ...p, sold, used, perWeek: (moved / days) * 7, daysLeft: daysOfStock(p.stockQty, moved, days), lastMoved: lastBy.get(p.id) ?? null, valueCents: p.stockQty * p.costCents };
    });
    const sellers = rows.filter((r) => r.sold + r.used > 0).sort((a, b) => b.sold + b.used - (a.sold + a.used));
    const runningOut = rows.filter((r) => r.daysLeft !== null && r.daysLeft <= 30 && r.stockQty >= 0).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    // Nothing sold or used in the whole window, yet stock sits there.
    const dead = rows.filter((r) => r.stockQty > 0 && r.sold + r.used <= 0).sort((a, b) => b.valueCents - a.valueCents);

    const cost = new Map(products.map((p) => [p.id, p.costCents]));
    const shrink = moves.filter((m) => (SHRINKAGE_REASONS as readonly string[]).includes(m.reason)).map((m) => ({ productId: m.productId, reason: m.reason, units: -Number(m.qty), valueCents: -Number(m.qty) * (cost.get(m.productId) ?? 0) }));
    const names = new Map(products.map((p) => [p.id, productLabel(p)]));
    const shrinkByProduct = [...shrink.reduce((acc, s) => acc.set(s.productId, { productId: s.productId, name: names.get(s.productId) ?? "Removed product", units: (acc.get(s.productId)?.units ?? 0) + s.units, valueCents: (acc.get(s.productId)?.valueCents ?? 0) + s.valueCents }), new Map<string, { productId: string; name: string; units: number; valueCents: number }>()).values()].sort((a, b) => b.valueCents - a.valueCents);
    const shrinkByReason = (SHRINKAGE_REASONS as readonly string[]).map((reason) => ({ reason, units: shrink.filter((s) => s.reason === reason).reduce((a, s) => a + s.units, 0), valueCents: shrink.filter((s) => s.reason === reason).reduce((a, s) => a + s.valueCents, 0) }));

    // What left the shelf, at what it cost when it left: sold to clients, and used up in services. A product can be both.
    const costRows = await tx
      .select({
        productId: schema.stockMovements.productId,
        soldUnits: sql<number>`coalesce(-sum(${schema.stockMovements.delta}) filter (where ${schema.stockMovements.reason} in ('sale','return')), 0)`,
        soldCost: sql<number>`coalesce(-sum(${schema.stockMovements.delta} * coalesce(${schema.stockMovements.unitCostCents}, ${schema.products.costCents})) filter (where ${schema.stockMovements.reason} in ('sale','return')), 0)`,
        usedUnits: sql<number>`coalesce(-sum(${schema.stockMovements.delta}) filter (where ${schema.stockMovements.reason} = 'used'), 0)`,
        usedCost: sql<number>`coalesce(-sum(${schema.stockMovements.delta} * coalesce(${schema.stockMovements.unitCostCents}, ${schema.products.costCents})) filter (where ${schema.stockMovements.reason} = 'used'), 0)`,
      })
      .from(schema.stockMovements)
      .innerJoin(schema.products, eq(schema.products.id, schema.stockMovements.productId))
      .where(and(gte(schema.stockMovements.createdAt, since), inArray(schema.stockMovements.reason, ["sale", "return", "used"])))
      .groupBy(schema.stockMovements.productId);
    const costSplit = costRows
      .map((r) => ({ productId: r.productId, name: names.get(r.productId) ?? "Removed product", soldUnits: Number(r.soldUnits), soldCostCents: Number(r.soldCost), usedUnits: Number(r.usedUnits), usedCostCents: Number(r.usedCost) }))
      .filter((r) => r.soldUnits || r.usedUnits)
      .sort((a, b) => b.soldCostCents + b.usedCostCents - (a.soldCostCents + a.usedCostCents));

    // Value on the shelf at the end of each of the last six months: today's value less everything that moved since (at today's costs).
    const nowValue = rows.reduce((s, r) => s + r.valueCents, 0);
    const history: { label: string; valueCents: number }[] = [];
    const now = new Date();
    for (let k = 0; k < 6; k++) {
      const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k + 1, 1));
      const label = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
      if (k === 0) {
        history.push({ label: "Now", valueCents: nowValue });
        continue;
      }
      const [after] = await tx
        .select({ v: sql<number>`coalesce(sum(${schema.stockMovements.delta} * ${schema.products.costCents}), 0)` })
        .from(schema.stockMovements)
        .innerJoin(schema.products, eq(schema.products.id, schema.stockMovements.productId))
        .where(and(gte(schema.stockMovements.createdAt, boundary), eq(schema.products.trackStock, true), eq(schema.products.active, true)));
      history.push({ label: `End of ${label}`, valueCents: nowValue - Number(after?.v ?? 0) });
    }
    return {
      days,
      sellers,
      runningOut,
      dead,
      deadValueCents: dead.reduce((s, r) => s + r.valueCents, 0),
      shrinkByProduct,
      shrinkByReason,
      shrinkTotalCents: shrinkByReason.reduce((s, r) => s + r.valueCents, 0),
      history,
      costSplit,
      soldCostCents: costSplit.reduce((a, r) => a + r.soldCostCents, 0),
      usedCostCents: costSplit.reduce((a, r) => a + r.usedCostCents, 0),
    };
  });
}

/** Tracked products with on-hand quantity and value at cost; the Reports page's stock table. */
export async function stockReport(businessId: string) {
  const { items } = await stockOverview(businessId);
  const sorted = [...items].map((i) => ({ ...i, low: i.status !== "ok" })).sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name));
  return { items: sorted, totalValueCents: items.reduce((s, i) => s + i.valueCents, 0), totalRetailCents: items.reduce((s, i) => s + i.retailCents, 0), lowCount: items.filter((i) => i.status !== "ok").length };
}

// ---- Spreadsheet import / export ----

export async function exportProducts(businessId: string) {
  const [{ items }, all] = await Promise.all([stockOverview(businessId), listAllProducts(businessId)]);
  const stock = new Map(items.map((i) => [i.id, i.stockQty]));
  return all.map((p) => ({ ...p, onHand: p.trackStock ? (stock.get(p.id) ?? 0) : null }));
}

export async function listAllProducts(businessId: string) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ p: schema.products, category: schema.productCategories.name, supplier: schema.suppliers.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.products.supplierId))
      .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel));
    return rows.map((r) => ({ ...r.p, category: r.category, supplierName: r.supplier }));
  });
}

export type ImportSummary = { created: number; updated: number; counted: number; skipped: string[] };

/**
 * Create or update products from a spreadsheet. A row matches an existing product by barcode, then SKU, then name + option.
 * A blank cell leaves the product's value alone. "On hand" sets the count at the main location (as a count, so it is in the history).
 * With `dryRun` nothing is written; the summary says what would happen.
 */
export async function importProducts(input: { businessId: string; rows: ParsedProductRow[]; dryRun: boolean; actorUserId: string }): Promise<ImportSummary> {
  const out: ImportSummary = { created: 0, updated: 0, counted: 0, skipped: [] };
  const run = async (tx: TenantDb) => {
    const existing = await tx.select().from(schema.products);
    const suppliers = await tx.select().from(schema.suppliers);
    const mainLoc = await mainLocationId(tx);
    const supplierId = async (name: string | null) => {
      if (!name) return undefined;
      const hit = suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (hit) return hit.id;
      if (input.dryRun) return null;
      const [s] = await tx.insert(schema.suppliers).values({ businessId: input.businessId, name: name.slice(0, 80) }).returning();
      suppliers.push(s!);
      return s!.id;
    };
    const seen = new Set<string>();
    for (const r of input.rows) {
      const lower = (v: string | null) => (v ?? "").toLowerCase();
      const match = existing.find((p) => (r.barcode && lower(p.barcode) === lower(r.barcode)) || (!r.barcode && r.sku && lower(p.sku) === lower(r.sku)) || (!r.barcode && !r.sku && lower(p.name) === lower(r.name) && lower(p.variantLabel) === lower(r.variantLabel)));
      const key = match?.id ?? `new:${lower(r.barcode)}|${lower(r.sku)}|${lower(r.name)}|${lower(r.variantLabel)}`;
      if (seen.has(key)) {
        out.skipped.push(`Row ${r.line}: ${r.name} appears twice in the file.`);
        continue;
      }
      seen.add(key);
      if (!match && r.priceCents == null && r.retail !== false) {
        out.skipped.push(`Row ${r.line}: ${r.name} is new but has no price.`);
        continue;
      }
      if (r.priceCents != null && r.priceCents < 0) {
        out.skipped.push(`Row ${r.line}: the price can't be negative.`);
        continue;
      }
      if (input.dryRun) {
        if (match) out.updated++;
        else out.created++;
        if (r.onHand != null) out.counted++;
        continue;
      }
      const categoryId = r.category ? await ensureCategory(input.businessId, "product", r.category) : undefined;
      const supId = await supplierId(r.supplier);
      const set = {
        name: r.name,
        ...(r.variantLabel ? { variantLabel: r.variantLabel } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(r.sku ? { sku: r.sku } : {}),
        ...(r.barcode ? { barcode: r.barcode } : {}),
        ...(r.priceCents != null ? { priceCents: r.priceCents } : {}),
        ...(r.costCents != null ? { costCents: r.costCents } : {}),
        ...(r.retail != null ? { kind: r.retail ? "retail" : "backbar" } : {}),
        ...(r.taxable != null ? { taxable: r.taxable } : {}),
        ...(r.sellOnline != null ? { sellOnline: r.sellOnline } : {}),
        ...(r.lowStock != null ? { lowStockThreshold: Math.max(0, r.lowStock) } : {}),
        ...(r.reorderUpTo != null ? { reorderUpTo: Math.max(0, r.reorderUpTo) } : {}),
        ...(supId !== undefined ? { supplierId: supId } : {}),
        ...(r.trackStock != null || r.onHand != null ? { trackStock: r.trackStock ?? true } : {}),
      };
      let id = match?.id;
      if (match) {
        await tx.update(schema.products).set(set).where(eq(schema.products.id, match.id));
        out.updated++;
      } else {
        const [p] = await tx.insert(schema.products).values({ businessId: input.businessId, priceCents: r.priceCents ?? 0, ...set }).returning({ id: schema.products.id });
        id = p!.id;
        existing.push({ ...(await tx.query.products.findFirst({ where: eq(schema.products.id, id) }))! });
        out.created++;
      }
      if (r.onHand != null && id) {
        const have = await qtyAt(tx, id, mainLoc);
        if (have !== r.onHand) {
          await applyMove(tx, { businessId: input.businessId, productId: id, locationId: mainLoc, delta: r.onHand - have, reason: match ? "count" : "opening", note: "Spreadsheet import", actorUserId: input.actorUserId });
          out.counted++;
        }
      }
    }
    if (!input.dryRun) await audit(tx, input.businessId, input.actorUserId, "inventory.import", input.businessId, { created: out.created, updated: out.updated, counted: out.counted });
  };
  await withTenant(input.businessId, run);
  return out;
}

// ---- Daily low-stock email ----

/** Hour of the day (business-local) the low-stock email goes out. */
export const DIGEST_HOUR = 8;

const localHour = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date())) % 24;

/**
 * Once a day, after 8am in the business's time zone, email whoever manages inventory about what is low, out or off.
 * Called from the reminders job; safe to run every few minutes (the day is claimed with one UPDATE).
 */
export async function sendLowStockDigests(): Promise<{ checked: number; sent: number }> {
  const businesses = await db.select().from(schema.businesses);
  let sent = 0;
  for (const b of businesses) {
    try {
      const today = instantToISODate(new Date(), b.timezone);
      if (b.inventoryDigestOn === today || localHour(b.timezone) < DIGEST_HOUR) continue;
      // Only what still needs doing: a count that is off, or a product that is low and not already covered by an order on its way.
      const locs = await listLocations(b.id);
      const multi = locs.length > 1;
      const short = (id: string) => locs.find((l) => l.id === id)?.name.replace(`${b.name} - `, "") ?? "";
      // One line per product per location that needs it, and only what still needs doing: a count that is off, or low and not already covered by an order on its way there.
      const low = (await lowStock(b.id)).flatMap((i) =>
        i.alerts
          .filter((a) => a.status === "negative" || suggestedOrderQty({ onHand: a.qty, onOrder: a.onOrder, threshold: i.lowStockThreshold, reorderUpTo: i.reorderUpTo }) > 0)
          .map((a) => ({ name: multi ? `${productLabel(i)} · ${short(a.locationId)}` : productLabel(i), onHand: a.qty, onOrder: a.onOrder, status: a.status })),
      );
      if (!low.length) continue;
      const roles = await withTenant(b.id, (tx) => tx.select({ key: schema.roles.key, permissions: schema.roles.permissions }).from(schema.roles));
      const keys = new Set(roles.filter((r) => r.permissions.filter(isAction).includes("inventory.manage")).map((r) => r.key));
      keys.add("owner");
      const people = await db.select({ email: schema.user.email, role: schema.member.role }).from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId)).where(eq(schema.member.organizationId, b.id));
      const to = [...new Set(people.filter((p) => keys.has(p.role)).map((p) => p.email))];
      if (!to.length) continue;
      const claimed = await db.update(schema.businesses).set({ inventoryDigestOn: today }).where(and(eq(schema.businesses.id, b.id), sql`(${schema.businesses.inventoryDigestOn} is null or ${schema.businesses.inventoryDigestOn} <> ${today})`)).returning({ id: schema.businesses.id });
      if (!claimed.length) continue;
      const t = lowStockEmail(
        { businessName: b.name, logoUrl: b.logoUrl, brandColor: b.brandColor, businessPhone: b.phone, address: b.addressLine },
        { items: low.slice(0, 25), more: Math.max(0, low.length - 25), link: appUrl(`/app/${b.slug}/inventory/reorder`) },
      );
      for (const email of to) await queueOneOff(b.id, { channel: "email", template: "low_stock", recipient: email, subject: t.subject, body: t.html });
      sent += to.length;
    } catch (e) {
      console.error("[inventory] digest failed", b.id, (e as Error).message);
    }
  }
  return { checked: businesses.length, sent };
}

