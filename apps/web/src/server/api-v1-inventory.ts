import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { apiAudit, ApiErrors, list, type ApiContext } from "@/lib/api";
import {
  applyCount, cancelOrder, createPurchaseOrder, getPurchaseOrder, listPurchaseOrders, logUsage, markOrdered, orderReceipts, receiveOrder, recordMovement,
  reorderSuggestions, setPoLine, stockByLocation, transferStock, undoMovement, undoReceipt, undoUsage, updatePurchaseOrder, visitSupplies,
} from "./inventory";
import { owned } from "./api-v1-catalog";

/**
 * The inventory half of the admin-parity API: stock by location, receiving, counts, transfers, reorder suggestions, suppliers, purchase orders,
 * and supplies logged on a visit. Each endpoint calls the same server function the staff app's action calls (recordMovement, applyCount,
 * transferStock, receiveOrder, ...), after proving that every id the request names belongs to the key's business: those functions lean on row-level
 * security alone, and a foreign key would walk past it. InventoryError becomes a 409 with the app's own message (see `guarded` in api-v1-catalog).
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status });
const money = z.number().int().min(0).max(10_000_000);
const idStr = z.string().min(1).max(100);
const qty = z.number().int().min(1).max(100_000);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const dupes = (ids: string[]) => new Set(ids).size !== ids.length;

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export async function stockApi(b: string, productId: string) {
  const p = await withTenant(b, (tx) => tx.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.businessId, b)), columns: { id: true, stockQty: true, trackStock: true, lowStockThreshold: true } }));
  if (!p) return ApiErrors.notFound("product");
  const rows = await stockByLocation(b, productId);
  return ok({ product_id: p.id, track_stock: p.trackStock, on_hand: p.stockQty, low_stock_threshold: p.lowStockThreshold, locations: rows.map((r) => ({ location_id: r.locationId, name: r.name, qty: r.qty })) });
}

export const receiveBody = z.object({
  location_id: idStr.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  items: z.array(z.object({ product_id: idStr, quantity: qty }).strict()).min(1).max(200),
}).strict();

/** A delivery with no purchase order: one or many products, one location, one note (the app's receiveStock). */
export async function receiveStockApi(ctx: ApiContext, d: z.infer<typeof receiveBody>) {
  const b = ctx.business.id;
  const miss = await owned(b, [[schema.locations, d.location_id, "location"], ...d.items.map((i) => [schema.products, i.product_id, "product"] as [typeof schema.products, string, string])]);
  if (miss) return ApiErrors.notFound(miss);
  let units = 0;
  for (const i of d.items) {
    await recordMovement({ businessId: b, productId: i.product_id, locationId: d.location_id ?? null, entered: i.quantity, reason: "received", note: d.note ?? null, actorUserId: ctx.actor });
    units += i.quantity;
  }
  await apiAudit(ctx, "api.stock.receive", "inventory", d.location_id ?? "main", { items: d.items, units });
  const now = await withTenant(b, (tx) => tx.select({ id: schema.products.id, qty: schema.products.stockQty }).from(schema.products).where(and(eq(schema.products.businessId, b), inArray(schema.products.id, d.items.map((i) => i.product_id)))));
  return ok({ units, products: new Set(d.items.map((i) => i.product_id)).size, on_hand: now.map((p) => ({ product_id: p.id, on_hand: p.qty })) }, 201);
}

/** Take back a delivery entered wrong (the app's undoReceiptAction): refused when some of it has already gone. */
export async function undoReceiptApi(ctx: ApiContext, movementId: string) {
  const b = ctx.business.id;
  const m = await withTenant(b, (tx) => tx.query.stockMovements.findFirst({ where: and(eq(schema.stockMovements.id, movementId), eq(schema.stockMovements.businessId, b)), columns: { id: true, productId: true } }));
  if (!m) return ApiErrors.notFound("stock movement");
  await undoReceipt({ businessId: b, movementId, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.stock.undo_receipt", "stock_movement", movementId);
  return ok({ id: movementId, product_id: m.productId, undone: true });
}

export const countBody = z.object({
  location_id: idStr,
  note: z.string().trim().max(120).nullable().optional(),
  counts: z.array(z.object({ product_id: idStr, counted: z.number().int().min(0).max(100_000) }).strict()).min(1).max(1000),
}).strict();

/** Set the count from what was physically counted at one location; only products whose count differs get a movement (the app's submitCount). */
export async function countStockApi(ctx: ApiContext, d: z.infer<typeof countBody>) {
  const b = ctx.business.id;
  if (dupes(d.counts.map((c) => c.product_id))) return ApiErrors.invalid("A product can only be counted once.");
  const miss = await owned(b, [[schema.locations, d.location_id, "location"], ...d.counts.map((c) => [schema.products, c.product_id, "product"] as [typeof schema.products, string, string])]);
  if (miss) return ApiErrors.notFound(miss);
  const r = await applyCount({ businessId: b, locationId: d.location_id, counts: d.counts.map((c) => ({ productId: c.product_id, counted: c.counted })), note: d.note ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.stock.count", "inventory", d.location_id, { counted: r.counted, changed: r.changed, units_off: r.unitsOff });
  return ok({ counted: r.counted, changed: r.changed, units_off: r.unitsOff }, 201);
}

export const transferBody = z.object({
  product_id: idStr, from_location_id: idStr, to_location_id: idStr, quantity: qty, note: z.string().trim().max(200).nullable().optional(),
}).strict();

/** Move units between two locations; the total does not change and the source cannot go below zero. */
export async function transferStockApi(ctx: ApiContext, d: z.infer<typeof transferBody>) {
  const b = ctx.business.id;
  const miss = await owned(b, [[schema.products, d.product_id, "product"], [schema.locations, d.from_location_id, "location"], [schema.locations, d.to_location_id, "location"]]);
  if (miss) return ApiErrors.notFound(miss);
  await transferStock({ businessId: b, productId: d.product_id, fromLocationId: d.from_location_id, toLocationId: d.to_location_id, qty: d.quantity, note: d.note ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.stock.transfer", "product", d.product_id, d);
  const now = await stockApi(b, d.product_id);
  return NextResponse.json(await now.json(), { status: 201 });
}

// ---- Supplies used (back bar), logged without a visit, and on a visit ----
export const usageBody = z.object({
  location_id: idStr.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  items: z.array(z.object({ product_id: idStr, quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(50),
}).strict();

/**
 * Log what was used up. It may take a count below zero rather than stop the work (the app's rule); that then shows as "count is off".
 * Pass `appointmentId` to log it against a visit (it comes off that visit's location).
 */
export async function logUsageApi(ctx: ApiContext, d: z.infer<typeof usageBody>, appointmentId: string | null) {
  const b = ctx.business.id;
  if (dupes(d.items.map((i) => i.product_id))) return ApiErrors.invalid("A product can only be listed once.");
  const miss = await owned(b, [[schema.locations, d.location_id, "location"], ...d.items.map((i) => [schema.products, i.product_id, "product"] as [typeof schema.products, string, string])]);
  if (miss) return ApiErrors.notFound(miss);
  const units = await logUsage({ businessId: b, appointmentId, locationId: d.location_id ?? null, items: d.items.map((i) => ({ productId: i.product_id, qty: i.quantity })), note: d.note ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.stock.log_usage", appointmentId ? "appointment" : "inventory", appointmentId ?? d.location_id ?? "main", { items: d.items });
  return ok({ units }, 201);
}

/** Take back a use logged by mistake (the app's undoLoggedAction; a key is business-wide, so anyone's entry may be taken back). Once only. */
export async function undoUsageMovementApi(ctx: ApiContext, movementId: string) {
  const b = ctx.business.id;
  const m = await withTenant(b, (tx) => tx.query.stockMovements.findFirst({ where: and(eq(schema.stockMovements.id, movementId), eq(schema.stockMovements.businessId, b)), columns: { id: true } }));
  if (!m) return ApiErrors.notFound("stock movement");
  await undoMovement({ businessId: b, movementId, actorUserId: ctx.actor, canManage: true });
  await apiAudit(ctx, "api.stock.undo_usage", "stock_movement", movementId);
  return ok({ id: movementId, undone: true });
}

const visitOf = (b: string, id: string) => withTenant(b, (tx) => tx.query.appointments.findFirst({ where: and(eq(schema.appointments.id, id), eq(schema.appointments.businessId, b), eq(schema.appointments.kind, "visit")), columns: { id: true } }));

export async function visitSuppliesApi(b: string, appointmentId: string) {
  if (!(await visitOf(b, appointmentId))) return ApiErrors.notFound("appointment");
  const v = await visitSupplies(b, appointmentId);
  return ok(v.logged.map((l) => ({ product_id: l.productId, label: l.label, quantity: l.qty })));
}
export async function logVisitSuppliesApi(ctx: ApiContext, appointmentId: string, d: z.infer<typeof usageBody>) {
  if (!(await visitOf(ctx.business.id, appointmentId))) return ApiErrors.notFound("appointment");
  return logUsageApi(ctx, d, appointmentId);
}
/** Take back supplies logged on a visit: `quantity` units (default all that are logged), never more than were logged. */
export async function undoVisitSuppliesApi(ctx: ApiContext, appointmentId: string, productId: string, quantity: number | null) {
  const b = ctx.business.id;
  if (!(await visitOf(b, appointmentId))) return ApiErrors.notFound("appointment");
  const miss = await owned(b, [[schema.products, productId, "product"]]);
  if (miss) return ApiErrors.notFound(miss);
  const logged = (await visitSupplies(b, appointmentId)).logged.find((l) => l.productId === productId)?.qty ?? 0;
  const n = quantity ?? logged;
  await undoUsage({ businessId: b, appointmentId, productId, qty: n, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.stock.undo_visit_supplies", "appointment", appointmentId, { product_id: productId, quantity: n });
  return ok({ product_id: productId, taken_back: n });
}

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------
export async function reorderSuggestionsApi(b: string) {
  const groups = await reorderSuggestions(b);
  return ok(groups.map((g) => ({
    supplier_id: g.supplierId, supplier_name: g.supplierName, location_id: g.locationId, location_name: g.locationName,
    items: g.items.map((i) => ({ product_id: i.productId, name: i.name, on_hand: i.onHand, on_order: i.onOrder, low_stock_threshold: i.threshold, suggested_qty: i.qty, unit_cost_cents: i.unitCostCents })),
  })));
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
type SupplierRow = typeof schema.suppliers.$inferSelect;
export const serializeSupplier = (s: SupplierRow) => ({
  id: s.id, name: s.name, contact_name: s.contactName, email: s.email, phone: s.phone, account_number: s.accountNumber, notes: s.notes, active: s.active, created_at: iso(s.createdAt),
});

export const supplierPatch = z.object({
  name: z.string().trim().min(1).max(80),
  contact_name: z.string().trim().max(80).nullable(),
  email: z.string().trim().toLowerCase().email().max(200).nullable(),
  phone: z.string().trim().max(40).nullable(),
  account_number: z.string().trim().max(60).nullable(),
  notes: z.string().trim().max(500).nullable(),
  active: z.boolean(),
}).partial().strict();
export const supplierCreate = supplierPatch.required({ name: true });

export async function listSuppliersApi(b: string, p: { limit: number; page: number; offset: number }, includeInactive: boolean) {
  const rows = await withTenant(b, (tx) => tx.select().from(schema.suppliers).where(and(eq(schema.suppliers.businessId, b), includeInactive ? undefined : eq(schema.suppliers.active, true))).orderBy(asc(schema.suppliers.name)).limit(p.limit).offset(p.offset));
  return list(rows.map(serializeSupplier), p);
}
export async function getSupplierApi(b: string, id: string) {
  const row = await withTenant(b, (tx) => tx.query.suppliers.findFirst({ where: and(eq(schema.suppliers.id, id), eq(schema.suppliers.businessId, b)) }));
  return row ? ok(serializeSupplier(row)) : ApiErrors.notFound("supplier");
}
export async function createSupplierApi(ctx: ApiContext, d: z.infer<typeof supplierCreate>) {
  const b = ctx.business.id;
  const [row] = await withTenant(b, (tx) => tx.insert(schema.suppliers).values({
    businessId: b, name: d.name, contactName: d.contact_name ?? null, email: d.email ?? null, phone: d.phone ?? null, accountNumber: d.account_number ?? null, notes: d.notes ?? null, active: d.active ?? true,
  }).returning());
  await apiAudit(ctx, "api.supplier.create", "supplier", row!.id, { name: d.name });
  return ok(serializeSupplier(row!), 201);
}
export async function patchSupplierApi(ctx: ApiContext, id: string, d: z.infer<typeof supplierPatch>) {
  const b = ctx.business.id;
  const out = await withTenant(b, async (tx) => {
    const cur = await tx.query.suppliers.findFirst({ where: and(eq(schema.suppliers.id, id), eq(schema.suppliers.businessId, b)) });
    if (!cur) return null;
    const set = {
      ...(d.name !== undefined ? { name: d.name } : {}), ...(d.contact_name !== undefined ? { contactName: d.contact_name } : {}), ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}), ...(d.account_number !== undefined ? { accountNumber: d.account_number } : {}), ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    };
    if (!Object.keys(set).length) return cur;
    const [row] = await tx.update(schema.suppliers).set(set).where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.businessId, b))).returning();
    return row!;
  });
  if (!out) return ApiErrors.notFound("supplier");
  await apiAudit(ctx, "api.supplier.update", "supplier", id, { fields: Object.keys(d) });
  return ok(serializeSupplier(out));
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
type PoRow = typeof schema.purchaseOrders.$inferSelect;
const serializePo = (po: PoRow) => ({
  id: po.id, number: po.number, status: po.status, supplier_id: po.supplierId, location_id: po.locationId, expected_on: po.expectedOn,
  ordered_at: iso(po.orderedAt), received_at: iso(po.receivedAt), reference: po.reference, notes: po.notes, created_at: iso(po.createdAt),
});

export async function listOrdersApi(b: string, p: { limit: number; page: number; offset: number }, status: "open" | "received" | "all") {
  const rows = await listPurchaseOrders(b, status);
  const page = rows.slice(p.offset, p.offset + p.limit);
  return list(page.map((r) => ({ ...serializePo(r), supplier_name: r.supplier, location_name: r.location, units: r.units, received_units: r.receivedUnits, cost_cents: r.costCents })), p, rows.length);
}

async function orderDetail(b: string, id: string) {
  const r = await getPurchaseOrder(b, id);
  if (!r) return null;
  const receipts = await orderReceipts(b, id);
  return {
    ...serializePo(r.po), supplier_name: r.supplier?.name ?? null, location_name: r.location?.name ?? null,
    lines: r.lines.map((l) => ({ id: l.id, product_id: l.productId, label: l.label, sku: l.sku, barcode: l.barcode, ordered_qty: l.orderedQty, received_qty: l.receivedQty, unit_cost_cents: l.unitCostCents })),
    receipts: receipts.map((x) => ({ movement_id: x.id, label: x.label, quantity: x.qty, at: iso(x.at), undone: x.undone })),
  };
}
export async function getOrderApi(b: string, id: string) {
  // getPurchaseOrder leans on row-level security, so prove the order is this business's first.
  if (await owned(b, [[schema.purchaseOrders, id, "purchase order"]])) return ApiErrors.notFound("purchase order");
  return ok(await orderDetail(b, id));
}

export const orderCreate = z.object({
  supplier_id: idStr.nullable().optional(),
  location_id: idStr.nullable().optional(),
  expected_on: dateStr.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  lines: z.array(z.object({ product_id: idStr, quantity: qty, unit_cost_cents: money.optional() }).strict()).max(200).optional(),
}).strict();
export const orderPatch = z.object({
  supplier_id: idStr.nullable(),
  location_id: idStr.nullable(),
  expected_on: dateStr.nullable(),
  reference: z.string().trim().max(80).nullable(),
  notes: z.string().trim().max(500).nullable(),
}).partial().strict();
export const lineAdd = z.object({ product_id: idStr, quantity: qty, unit_cost_cents: money.optional() }).strict();
export const linePatch = z.object({ quantity: qty, unit_cost_cents: money.nullable() }).partial().strict();
export const receiveOrderBody = z.object({
  reference: z.string().trim().max(80).nullable().optional(),
  lines: z.array(z.object({ line_id: idStr, quantity: qty, unit_cost_cents: money.nullable().optional() }).strict()).min(1).max(500),
}).strict();

export async function createOrderApi(ctx: ApiContext, d: z.infer<typeof orderCreate>) {
  const b = ctx.business.id;
  const lines = d.lines ?? [];
  if (dupes(lines.map((l) => l.product_id))) return ApiErrors.invalid("A product can only be on an order once.");
  const miss = await owned(b, [[schema.suppliers, d.supplier_id, "supplier"], [schema.locations, d.location_id, "location"], ...lines.map((l) => [schema.products, l.product_id, "product"] as [typeof schema.products, string, string])]);
  if (miss) return ApiErrors.notFound(miss);
  const po = await createPurchaseOrder({
    businessId: b, supplierId: d.supplier_id ?? null, locationId: d.location_id ?? null, expectedOn: d.expected_on ?? null, notes: d.notes ?? null,
    lines: lines.map((l) => ({ productId: l.product_id, qty: l.quantity, ...(l.unit_cost_cents !== undefined ? { unitCostCents: l.unit_cost_cents } : {}) })), actorUserId: ctx.actor,
  });
  await apiAudit(ctx, "api.purchase_order.create", "purchase_order", po.id, { number: po.number });
  return ok(await orderDetail(b, po.id), 201);
}

export async function patchOrderApi(ctx: ApiContext, id: string, d: z.infer<typeof orderPatch>) {
  const b = ctx.business.id;
  const cur = await withTenant(b, (tx) => tx.query.purchaseOrders.findFirst({ where: and(eq(schema.purchaseOrders.id, id), eq(schema.purchaseOrders.businessId, b)) }));
  if (!cur) return ApiErrors.notFound("purchase order");
  const miss = await owned(b, [[schema.suppliers, d.supplier_id, "supplier"], [schema.locations, d.location_id, "location"]]);
  if (miss) return ApiErrors.notFound(miss);
  await updatePurchaseOrder({
    businessId: b, id,
    supplierId: d.supplier_id !== undefined ? d.supplier_id : cur.supplierId, locationId: d.location_id !== undefined ? d.location_id : cur.locationId,
    expectedOn: d.expected_on !== undefined ? d.expected_on : cur.expectedOn, notes: d.notes !== undefined ? d.notes : cur.notes, reference: d.reference !== undefined ? d.reference : cur.reference,
  });
  await apiAudit(ctx, "api.purchase_order.update", "purchase_order", id, { fields: Object.keys(d) });
  return ok(await orderDetail(b, id));
}

/** The order must be this business's and its line (when named) must be on it. */
async function orderOwned(b: string, id: string) {
  return owned(b, [[schema.purchaseOrders, id, "purchase order"]]);
}

export async function addLineApi(ctx: ApiContext, id: string, d: z.infer<typeof lineAdd>) {
  const b = ctx.business.id;
  const miss = (await orderOwned(b, id)) ?? (await owned(b, [[schema.products, d.product_id, "product"]]));
  if (miss) return ApiErrors.notFound(miss);
  await setPoLine({ businessId: b, id, productId: d.product_id, qty: d.quantity, unitCostCents: d.unit_cost_cents ?? null });
  await apiAudit(ctx, "api.purchase_order.line_set", "purchase_order", id, d);
  return ok(await orderDetail(b, id), 201);
}

const lineOf = (b: string, orderId: string, productId: string) =>
  withTenant(b, (tx) => tx.query.purchaseOrderLines.findFirst({ where: and(eq(schema.purchaseOrderLines.purchaseOrderId, orderId), eq(schema.purchaseOrderLines.productId, productId), eq(schema.purchaseOrderLines.businessId, b)) }));

export async function patchLineApi(ctx: ApiContext, id: string, productId: string, d: z.infer<typeof linePatch>) {
  const b = ctx.business.id;
  if (await orderOwned(b, id)) return ApiErrors.notFound("purchase order");
  const line = await lineOf(b, id, productId);
  if (!line) return ApiErrors.notFound("order line");
  await setPoLine({ businessId: b, id, productId, qty: d.quantity ?? line.orderedQty, unitCostCents: d.unit_cost_cents !== undefined ? d.unit_cost_cents : line.unitCostCents });
  await apiAudit(ctx, "api.purchase_order.line_set", "purchase_order", id, { product_id: productId, ...d });
  return ok(await orderDetail(b, id));
}

/** A line that has already received stock stays (take the delivery back first). */
export async function deleteLineApi(ctx: ApiContext, id: string, productId: string) {
  const b = ctx.business.id;
  if (await orderOwned(b, id)) return ApiErrors.notFound("purchase order");
  const line = await lineOf(b, id, productId);
  if (!line) return ApiErrors.notFound("order line");
  if (line.receivedQty > 0) return ApiErrors.conflict("Some of this line has already arrived. Undo the delivery first.");
  await setPoLine({ businessId: b, id, productId, qty: 0 });
  await apiAudit(ctx, "api.purchase_order.line_remove", "purchase_order", id, { product_id: productId });
  return ok(await orderDetail(b, id));
}

export async function markOrderedApi(ctx: ApiContext, id: string) {
  const b = ctx.business.id;
  if (await orderOwned(b, id)) return ApiErrors.notFound("purchase order");
  await markOrdered({ businessId: b, id, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.purchase_order.ordered", "purchase_order", id);
  return ok(await orderDetail(b, id));
}
export async function cancelOrderApi(ctx: ApiContext, id: string) {
  const b = ctx.business.id;
  if (await orderOwned(b, id)) return ApiErrors.notFound("purchase order");
  await cancelOrder({ businessId: b, id, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.purchase_order.cancel", "purchase_order", id);
  return ok(await orderDetail(b, id));
}

/** Take delivery of all or part of an order: adds the stock, sets each product's cost to what was paid, and closes the order when everything has arrived. */
export async function receiveOrderApi(ctx: ApiContext, id: string, d: z.infer<typeof receiveOrderBody>) {
  const b = ctx.business.id;
  if (await orderOwned(b, id)) return ApiErrors.notFound("purchase order");
  const lineIds = d.lines.map((l) => l.line_id);
  if (dupes(lineIds)) return ApiErrors.invalid("A line can only be listed once.");
  const mine = await withTenant(b, (tx) => tx.select({ id: schema.purchaseOrderLines.id }).from(schema.purchaseOrderLines).where(and(eq(schema.purchaseOrderLines.purchaseOrderId, id), eq(schema.purchaseOrderLines.businessId, b), inArray(schema.purchaseOrderLines.id, lineIds))));
  if (mine.length !== lineIds.length) return ApiErrors.notFound("order line");
  const r = await receiveOrder({ businessId: b, id, lines: d.lines.map((l) => ({ lineId: l.line_id, qty: l.quantity, unitCostCents: l.unit_cost_cents ?? null })), reference: d.reference ?? null, actorUserId: ctx.actor });
  await apiAudit(ctx, "api.purchase_order.receive", "purchase_order", id, { units: r.units, done: r.done });
  return NextResponse.json({ data: { units: r.units, done: r.done, order: await orderDetail(b, id) } }, { status: 201 });
}
