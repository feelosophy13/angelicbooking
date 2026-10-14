// Integration check for inventory against the local demo data (run `pnpm demo:refresh` first; it changes demo-twosites' stock).
// Usage: pnpm --filter @angelic/web inventory:check
import "../../../packages/db/src/env";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { readProductRows, PRODUCT_CSV_HEADERS } from "../src/lib/inventory";
import {
  applyCount, cancelOrder, createPurchaseOrder, decrementStockForSale, findProductByCode, getPurchaseOrder, listLocations, lowStock, markOrdered, onlineAvailability, receiveOrder,
  recordMovement, reorderSuggestions, returnToShelf, saleStockState, stockByLocation, stockOverview, transferStock, InventoryError, inventoryReport, importProducts, exportProducts, lowStockCount, logUsage, undoUsage, visitSupplies, recentlyLoggedBy, undoMovement, togglePin, pinnedProductIds, supplyCosts, recentUsage,
} from "../src/server/inventory";

const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, "demo-twosites") });
if (!business) throw new Error("run pnpm demo:refresh first");
const B = business.id;
const actor = (await db.query.member.findFirst({ where: eq(schema.member.organizationId, B) }))!.userId;
let n = 0;
const ok = (msg: string) => console.log(`  ✓ ${++n}. ${msg}`);
const product = async (name: string, label?: string) => {
  const all = await withTenant(B, (tx) => tx.select().from(schema.products));
  const p = all.find((x) => x.name === name && (x.variantLabel ?? undefined) === label);
  if (!p) throw new Error(`no product ${name}`);
  return p;
};
const fresh = async (id: string) => (await withTenant(B, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, id) })))!;
const at = async (id: string, loc: string) => (await stockByLocation(B, id)).find((l) => l.locationId === loc)?.qty ?? 0;
const sumLocs = async (id: string) => (await stockByLocation(B, id)).reduce((s, l) => s + l.qty, 0);
await withTenant(B, (tx) => tx.delete(schema.products).where(eq(schema.products.name, "Check Product"))); // so the check can be re-run
const locs = await listLocations(B);
assert.ok(locs.length > 1, "needs the two-site demo");
const [main, second] = [locs[0]!.id, locs[1]!.id];

console.log("Consistency");
for (const p of (await stockOverview(B)).items) assert.equal(p.stockQty, await sumLocs(p.id), `${p.name}: stock_qty equals the sum of locations`);
ok("every tracked product's total equals the sum of its locations");

console.log("Finding products");
const toner = await product("LAVIEN Centella Toner");
assert.equal((await findProductByCode(B, toner.barcode!))?.id, toner.id);
assert.equal((await findProductByCode(B, toner.sku!.toLowerCase()))?.id, toner.id);
assert.equal(await findProductByCode(B, "nope-nope"), null);
ok("a barcode or SKU finds the product (case-insensitive); an unknown code finds nothing");

console.log("Manual movements");
const before = await sumLocs(toner.id);
await recordMovement({ businessId: B, productId: toner.id, locationId: main, entered: 5, reason: "received", note: "check", actorUserId: actor });
assert.equal(await sumLocs(toner.id), before + 5);
await recordMovement({ businessId: B, productId: toner.id, locationId: main, entered: 2, reason: "damage", note: "check", actorUserId: actor });
assert.equal(await sumLocs(toner.id), before + 3);
assert.equal((await fresh(toner.id)).stockQty, before + 3);
ok("received adds, damaged removes, total follows");
await assert.rejects(() => recordMovement({ businessId: B, productId: toner.id, locationId: main, entered: 9999, reason: "lost", note: null, actorUserId: actor }), InventoryError);
ok("a write-off can't take stock below zero");

console.log("Transfer");
const t0 = [await at(toner.id, main), await at(toner.id, second)];
await transferStock({ businessId: B, productId: toner.id, fromLocationId: main, toLocationId: second, qty: 2, note: "check", actorUserId: actor });
assert.deepEqual([await at(toner.id, main), await at(toner.id, second)], [t0[0]! - 2, t0[1]! + 2]);
assert.equal(await sumLocs(toner.id), before + 3);
await assert.rejects(() => transferStock({ businessId: B, productId: toner.id, fromLocationId: main, toLocationId: second, qty: 9999, note: null, actorUserId: actor }), InventoryError);
ok("transfer moves units between sites without changing the total, and can't overdraw");

console.log("Count");
const c = await applyCount({ businessId: B, locationId: main, counts: [{ productId: toner.id, counted: (await at(toner.id, main)) + 1 }], note: "check", actorUserId: actor });
assert.deepEqual([c.counted, c.changed, c.unitsOff], [1, 1, 1]);
const same = await applyCount({ businessId: B, locationId: main, counts: [{ productId: toner.id, counted: await at(toner.id, main) }], note: null, actorUserId: actor });
assert.equal(same.changed, 0);
ok("a count corrects what differs and leaves what matches");

console.log("Sale: stock out, refund does not restock, put back on the shelf");
const serum = await product("Lash Growth Serum");
const serumBefore = await at(serum.id, second);
const sale = await withTenant(B, async (tx) => {
  const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${B}) as n`);
  const [s] = await tx.insert(schema.sales).values({ businessId: B, number: Number(rows[0]!.n), locationId: second, status: "paid", subtotalCents: 1000, totalCents: 1000, paidCents: 1000, closedAt: new Date() }).returning();
  await tx.insert(schema.saleLines).values({ businessId: B, saleId: s!.id, kind: "product", productId: serum.id, name: serum.name, quantity: 2, unitCents: 500, amountCents: 1000 });
  await decrementStockForSale(tx, B, s!.id);
  await decrementStockForSale(tx, B, s!.id); // closing twice changes nothing more
  return s!;
});
assert.equal(await at(serum.id, second), serumBefore - 2);
ok("closing a sale takes the products off the sale's location, once");
await withTenant(B, (tx) => tx.update(schema.sales).set({ status: "refunded", refundedCents: 1000 }).where(eq(schema.sales.id, sale.id)));
assert.equal(await at(serum.id, second), serumBefore - 2);
ok("a refund leaves the stock alone");
await returnToShelf({ businessId: B, saleId: sale.id, items: [{ productId: serum.id, qty: 1 }], note: "unopened", actorUserId: actor });
assert.equal(await at(serum.id, second), serumBefore - 1);
const st = (await saleStockState(B, sale.id)).get(serum.id)!;
assert.deepEqual(st, { sold: 2, returned: 1 });
await assert.rejects(() => returnToShelf({ businessId: B, saleId: sale.id, items: [{ productId: serum.id, qty: 2 }], note: null, actorUserId: actor }), InventoryError);
await returnToShelf({ businessId: B, saleId: sale.id, items: [{ productId: serum.id, qty: 1 }], note: null, actorUserId: actor });
await assert.rejects(() => returnToShelf({ businessId: B, saleId: sale.id, items: [{ productId: serum.id, qty: 1 }], note: null, actorUserId: actor }), InventoryError);
assert.equal(await at(serum.id, second), serumBefore);
ok("goods put back on the shelf on purpose, never more than were sold");

console.log("Overselling is allowed at the desk but flagged");
const gift = await product("Luxe Gift Box");
const sellQty = Math.max(1, (await fresh(gift.id)).stockQty) + 5; // more than is there, whatever earlier runs left
await withTenant(B, async (tx) => {
  const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${B}) as n`);
  const [s] = await tx.insert(schema.sales).values({ businessId: B, number: Number(rows[0]!.n), locationId: main, status: "paid", subtotalCents: 100, totalCents: 100, paidCents: 100, closedAt: new Date() }).returning();
  await tx.insert(schema.saleLines).values({ businessId: B, saleId: s!.id, kind: "product", productId: gift.id, name: gift.name, quantity: sellQty, unitCents: 2, amountCents: 100 });
  await decrementStockForSale(tx, B, s!.id);
});
assert.ok((await fresh(gift.id)).stockQty < 0);
assert.ok((await lowStock(B)).some((i) => i.id === gift.id && i.status === "negative"));
await recordMovement({ businessId: B, productId: gift.id, locationId: main, entered: sellQty + 10, reason: "adjust", note: "recount", actorUserId: actor });
assert.ok((await fresh(gift.id)).stockQty > 0);
ok("a sale can take the count negative; it shows as 'count is off' and a correction is allowed");

console.log("Online availability");
const sealant = await product("Lash Sealant");
await recordMovement({ businessId: B, productId: sealant.id, locationId: second, entered: 3, reason: "received", note: "check", actorUserId: actor });
const avail = async () => withTenant(B, (tx) => onlineAvailability(tx, second, [sealant.id])).then((m) => m.get(sealant.id));
const a0 = await avail();
await withTenant(B, async (tx) => {
  const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${B}) as n`);
  const [s] = await tx.insert(schema.sales).values({ businessId: B, number: Number(rows[0]!.n), locationId: second, status: "open", source: "online", subtotalCents: 100, totalCents: 100 }).returning();
  await tx.insert(schema.saleLines).values({ businessId: B, saleId: s!.id, kind: "product", productId: sealant.id, name: sealant.name, quantity: 2, unitCents: 50, amountCents: 100 });
});
assert.equal(await avail(), a0! - 2);
ok("another buyer's unpaid online order holds stock back");

console.log("Orders and reorder");
const sugBefore = await reorderSuggestions(B);
const po = await createPurchaseOrder({ businessId: B, supplierId: null, lines: [{ productId: sealant.id, qty: 5 }], actorUserId: actor });
assert.equal(po.number > 0, true);
await markOrdered({ businessId: B, id: po.id, actorUserId: actor });
const d = (await getPurchaseOrder(B, po.id))!;
const q0 = await sumLocs(sealant.id);
const r1 = await receiveOrder({ businessId: B, id: po.id, lines: [{ lineId: d.lines[0]!.id, qty: 2, unitCostCents: 123 }], actorUserId: actor });
assert.deepEqual(r1, { units: 2, done: false });
assert.equal((await getPurchaseOrder(B, po.id))!.po.status, "partial");
assert.equal((await fresh(sealant.id)).costCents, 123);
const r2 = await receiveOrder({ businessId: B, id: po.id, lines: [{ lineId: d.lines[0]!.id, qty: 3 }], actorUserId: actor });
assert.equal(r2.done, true);
assert.equal(await sumLocs(sealant.id), q0 + 5);
await assert.rejects(() => cancelOrder({ businessId: B, id: po.id, actorUserId: actor }), InventoryError);
ok("an order is received in two parts, stock and cost follow, and a finished order can't be cancelled");
assert.ok(Array.isArray(sugBefore));

console.log("Supplies logged by staff");
const t1 = await product("Eye gel patches (pair)");
const t1Before = await at(t1.id, second);
const appt = (await withTenant(B, (tx) => tx.select().from(schema.appointments).where(eq(schema.appointments.kind, "visit")).limit(1)))[0]!;
await withTenant(B, (tx) => tx.update(schema.appointments).set({ locationId: second }).where(eq(schema.appointments.id, appt.id)));
await withTenant(B, (tx) => tx.delete(schema.stockMovements).where(eq(schema.stockMovements.appointmentId, appt.id)));
await logUsage({ businessId: B, appointmentId: appt.id, items: [{ productId: t1.id, qty: 3 }], note: null, actorUserId: actor });
assert.equal(await at(t1.id, second), t1Before - 3);
let vs = await visitSupplies(B, appt.id);
assert.deepEqual(vs.logged.map((l) => l.qty), [3]);
ok("logging supplies on a visit takes them off the visit's location");
await undoUsage({ businessId: B, appointmentId: appt.id, productId: t1.id, qty: 1, actorUserId: actor });
assert.equal(await at(t1.id, second), t1Before - 2);
await assert.rejects(() => undoUsage({ businessId: B, appointmentId: appt.id, productId: t1.id, qty: 5, actorUserId: actor }), InventoryError);
vs = await visitSupplies(B, appt.id);
assert.deepEqual(vs.logged.map((l) => l.qty), [2]);
ok("taking some back puts it back, never more than was logged");
const stamped = await withTenant(B, (tx) => tx.select().from(schema.stockMovements).where(eq(schema.stockMovements.appointmentId, appt.id)));
assert.ok(stamped.every((m) => m.unitCostCents === t1.costCents));
await withTenant(B, (tx) => tx.update(schema.products).set({ costCents: t1.costCents + 999 }).where(eq(schema.products.id, t1.id)));
const rep0 = await inventoryReport(B, 90);
const row = rep0.costSplit.find((c) => c.productId === t1.id)!;
assert.ok(row.usedUnits >= 2);
await withTenant(B, (tx) => tx.update(schema.products).set({ costCents: t1.costCents }).where(eq(schema.products.id, t1.id)));
ok("each movement keeps the cost when it happened, so later price changes don't rewrite history");
const repSplit = await inventoryReport(B, 90);
assert.equal(repSplit.soldCostCents + repSplit.usedCostCents, repSplit.costSplit.reduce((a, r) => a + r.soldCostCents + r.usedCostCents, 0));
ok("the report separates what was sold from what was used up");

const mineList = await recentlyLoggedBy(B, actor);
assert.equal(mineList[0], t1.id);
ok("a person's most recently logged product comes first");

console.log("Log usage page: pins, taking back, supply costs");
const pinTarget = await product("Disposable applicators");
assert.equal(await togglePin({ businessId: B, userId: actor, productId: pinTarget.id }), true);
assert.ok((await pinnedProductIds(B, actor)).includes(pinTarget.id));
assert.equal(await togglePin({ businessId: B, userId: actor, productId: pinTarget.id }), false);
assert.ok(!(await pinnedProductIds(B, actor)).includes(pinTarget.id));
ok("a product can be pinned and unpinned, per person");
const applicBefore = await at(pinTarget.id, second);
await logUsage({ businessId: B, locationId: second, items: [{ productId: pinTarget.id, qty: 3 }], note: null, actorUserId: actor });
const mv = (await recentUsage(B, 5)).find((m) => m.productId === pinTarget.id && m.delta === -3 && !m.takenBack)!;
assert.ok(mv);
await assert.rejects(() => undoMovement({ businessId: B, movementId: mv.id, actorUserId: "someone-else", canManage: false }), InventoryError);
await undoMovement({ businessId: B, movementId: mv.id, actorUserId: actor, canManage: false });
assert.equal(await at(pinTarget.id, second), applicBefore);
await assert.rejects(() => undoMovement({ businessId: B, movementId: mv.id, actorUserId: actor, canManage: true }), InventoryError);
assert.ok((await recentUsage(B, 10)).find((m) => m.id === mv.id)!.takenBack);
ok("your own entry can be taken back once; someone else's can't (unless they manage inventory)");
const doneAppt = (await withTenant(B, (tx) => tx.select({ id: schema.appointments.id }).from(schema.appointments).innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id)).where(sql`${schema.appointments.kind} = 'visit' and ${schema.appointmentItems.status} = 'completed' and ${schema.appointmentItems.startAt} > now() - interval '60 days'`).limit(1)))[0]!;
const sumCosts = (r: Awaited<ReturnType<typeof supplyCosts>>) => r.services.reduce((a, x) => a + x.costCents, 0);
const sc0 = await supplyCosts(B, 90);
await logUsage({ businessId: B, appointmentId: doneAppt.id, items: [{ productId: pinTarget.id, qty: 4 }], note: null, actorUserId: actor });
const sc1 = await supplyCosts(B, 90);
const added = sumCosts(sc1) - sumCosts(sc0);
assert.ok(Math.abs(added - 4 * pinTarget.costCents) <= 3, `expected about ${4 * pinTarget.costCents}, got ${added}`);
assert.ok(sc1.visitsWithSupplies >= sc0.visitsWithSupplies);
const rows = sc1.services.filter((x) => x.logged);
assert.ok(rows.length > 0 && rows.every((x) => x.avgPerLoggedCents === Math.round(x.costCents / x.logged)));
ok("supplies logged on a visit are attributed to its services at what they cost, with averages per logged visit");
await undoUsage({ businessId: B, appointmentId: doneAppt.id, productId: pinTarget.id, qty: 4, actorUserId: actor });
const onVisit = (await recentUsage(B, 30)).find((m) => m.appointmentId === doneAppt.id && m.delta < 0)!;
await assert.rejects(() => undoMovement({ businessId: B, movementId: onVisit.id, actorUserId: actor, canManage: true }), InventoryError);
ok("something logged on a visit is taken back on that visit, not from the general list");

console.log("Per-location alerts");
const closeSaleAt = async (loc: string, lines: (typeof schema.saleLines.$inferInsert)[]) =>
  withTenant(B, async (tx) => {
    const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${B}) as n`);
    const [sl] = await tx.insert(schema.sales).values({ businessId: B, number: Number(rows[0]!.n), locationId: loc, status: "paid", subtotalCents: 100, totalCents: 100, paidCents: 100, closedAt: new Date() }).returning();
    await tx.insert(schema.saleLines).values(lines.map((l) => ({ ...l, saleId: sl!.id })));
    await decrementStockForSale(tx, B, sl!.id);
  });
const cleanser = await product("Gentle Cleanser");
await applyCount({ businessId: B, locationId: main, counts: [{ productId: cleanser.id, counted: 12 }], note: null, actorUserId: actor });
await applyCount({ businessId: B, locationId: second, counts: [{ productId: cleanser.id, counted: 2 }], note: null, actorUserId: actor });
await closeSaleAt(second, [{ businessId: B, saleId: "", kind: "product", productId: cleanser.id, name: cleanser.name, quantity: 2, unitCents: 50, amountCents: 100 }]);
const ov = async (id: string) => (await stockOverview(B)).items.find((i) => i.id === id)!;
let item = await ov(cleanser.id);
assert.equal(item.stockQty, 12);
assert.deepEqual(item.alerts.map((a) => [a.locationId, a.status]), [[second, "out"]]);
assert.equal(item.status, "out");
ok("twelve at the main site doesn't hide none at the other: the alert is for that location");
const groups = await reorderSuggestions(B);
const forCleanser = groups.filter((g) => g.items.some((i) => i.productId === cleanser.id));
assert.deepEqual(forCleanser.map((g) => g.locationId), [second]);
assert.ok(forCleanser[0]!.items.find((i) => i.productId === cleanser.id)!.qty > 0);
ok("the reorder suggestion is for that location, so the order is delivered there");
const adhesiveP = await product("Lash Adhesive (pro)");
await applyCount({ businessId: B, locationId: main, counts: [{ productId: adhesiveP.id, counted: 20 }], note: null, actorUserId: actor });
await applyCount({ businessId: B, locationId: second, counts: [{ productId: adhesiveP.id, counted: 2 }], note: null, actorUserId: actor });
await logUsage({ businessId: B, locationId: second, items: [{ productId: adhesiveP.id, qty: 2 }], note: null, actorUserId: actor });
item = await ov(adhesiveP.id);
assert.deepEqual(item.alerts.map((a) => [a.locationId, a.status]), [[second, "out"]]);
ok("back-bar products used up alert at the location where staff logged them");
const pillow = await product("Silk Pillowcase");
await applyCount({ businessId: B, locationId: second, counts: [{ productId: pillow.id, counted: 0 }], note: null, actorUserId: actor });
await applyCount({ businessId: B, locationId: main, counts: [{ productId: pillow.id, counted: 5 }], note: null, actorUserId: actor });
assert.equal((await ov(pillow.id)).alerts.length, 0);
ok("a product with none at a site that never sold it there stays quiet");
const attention = (await stockOverview(B)).items.filter((i) => i.status !== "ok").length;
assert.equal(await lowStockCount(B), attention);
ok("the sidebar count matches the overview");

console.log("Spreadsheet import");
const grid = [["Name", "Barcode", "Price", "On hand", "Supplier"], [toner.name, toner.barcode!, "41.25", "", ""], ["Check Product", "999000111222", "9.50", "7", "Check Supplier"], ["", "x", "", "", ""]];
const parsed = readProductRows(grid);
assert.equal(parsed.rows.length, 2);
assert.equal(parsed.errors.length, 1);
const dry = await importProducts({ businessId: B, rows: parsed.rows, dryRun: true, actorUserId: actor });
assert.deepEqual([dry.created, dry.updated, dry.counted], [1, 1, 1]);
assert.equal((await product("Check Product").catch(() => null)), null);
ok("a check-only import changes nothing and says what it would do");
const real = await importProducts({ businessId: B, rows: parsed.rows, dryRun: false, actorUserId: actor });
assert.deepEqual([real.created, real.updated, real.counted], [1, 1, 1]);
const made = await product("Check Product");
assert.equal(made.priceCents, 950);
assert.equal(made.stockQty, 7);
assert.equal((await fresh(toner.id)).priceCents, 4125);
assert.equal((await fresh(toner.id)).costCents, toner.costCents, "a blank cell leaves the cost alone");
const again = await importProducts({ businessId: B, rows: readProductRows([["Name", "Barcode", "On hand"], ["Check Product", "999000111222", "7"]]).rows, dryRun: false, actorUserId: actor });
assert.deepEqual([again.created, again.updated, again.counted], [0, 1, 0]);
ok("import creates, updates by barcode, leaves blanks alone, sets counts, and a repeat creates nothing");
const exported = await exportProducts(B);
assert.ok(exported.some((p) => p.name === "Check Product" && p.onHand === 7));
assert.equal(PRODUCT_CSV_HEADERS.length, 15);
ok("export includes the new product with its count");

console.log("Report");
const rep = await inventoryReport(B, 90);
assert.ok(rep.sellers.length > 0 && rep.history.length === 6);
ok("the movement report builds");

console.log(`\nAll ${n} checks passed.`);
process.exit(0);
