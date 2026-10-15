/**
 * Integration test: the inventory half of the admin-parity API (stock by location, receiving, counts, transfers, usage, reorder suggestions,
 * suppliers, purchase orders, supplies logged on a visit). Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 * Nothing here calls a third party or sends a message.
 */
// The env import must come first: @angelic/db connects when it is imported, and without DATABASE_URL it falls back to a superuser connection that skips row-level security.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

import { GET as listInventory } from "@/app/api/v1/inventory/route";
import { GET as reorder } from "@/app/api/v1/inventory/reorder-suggestions/route";
import { GET as getStock } from "@/app/api/v1/products/[id]/stock/route";
import { POST as postReceipt } from "@/app/api/v1/stock/receipts/route";
import { POST as undoReceipt } from "@/app/api/v1/stock/receipts/[id]/undo/route";
import { POST as postCount } from "@/app/api/v1/stock/counts/route";
import { POST as postTransfer } from "@/app/api/v1/stock/transfers/route";
import { POST as postUsage } from "@/app/api/v1/stock/usage/route";
import { POST as undoUsage } from "@/app/api/v1/stock/usage/[id]/undo/route";
import { GET as listSuppliers, POST as postSupplier } from "@/app/api/v1/suppliers/route";
import { GET as getSupplier, PATCH as patchSupplier } from "@/app/api/v1/suppliers/[id]/route";
import { GET as listOrders, POST as postOrder } from "@/app/api/v1/purchase-orders/route";
import { GET as getOrder, PATCH as patchOrder } from "@/app/api/v1/purchase-orders/[id]/route";
import { POST as addLine } from "@/app/api/v1/purchase-orders/[id]/lines/route";
import { PATCH as patchLine, DELETE as deleteLine } from "@/app/api/v1/purchase-orders/[id]/lines/[productId]/route";
import { POST as markOrdered } from "@/app/api/v1/purchase-orders/[id]/order/route";
import { POST as receiveOrder } from "@/app/api/v1/purchase-orders/[id]/receive/route";
import { POST as cancelOrder } from "@/app/api/v1/purchase-orders/[id]/cancel/route";
import { GET as getSupplies, POST as postSupplies } from "@/app/api/v1/appointments/[id]/supplies/route";
import { DELETE as deleteSupplies } from "@/app/api/v1/appointments/[id]/supplies/[productId]/route";
import { POST as stockAdjust } from "@/app/api/v1/products/[id]/stock-adjustments/route";
import { GET as stockMoves } from "@/app/api/v1/products/[id]/stock-movements/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let key: string; // inventory:write, a fresh one per block (the API allows 120 requests a minute per key)
let readKey: string; // inventory:read only
let otherScope: string; // a scope that is not inventory:*
const ids: Record<string, string> = {};
const noParams = {} as Record<string, never>;
const url = (qs: string) => `http://x/api/v1/t?${qs}`;

describe.skipIf(!up)("API: inventory", () => {
  beforeAll(async () => {
    kit = await setupKit(["inventory:write"]);
    readKey = await mkKey(kit.A, ["inventory:read"]);
    otherScope = await mkKey(kit.A, ["catalog:write"]);
    for (const biz of [kit.A, kit.B]) {
      const ins = <T,>(f: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(biz, f);
      const [loc] = await ins((tx) => tx.insert(schema.locations).values({ businessId: biz, name: "Main", isDefault: true }).returning());
      const [loc2] = await ins((tx) => tx.insert(schema.locations).values({ businessId: biz, name: "Second" }).returning());
      const [sup] = await ins((tx) => tx.insert(schema.suppliers).values({ businessId: biz, name: "Acme", notes: "keep me", phone: "555" }).returning());
      const mk = (name: string, extra: Partial<typeof schema.products.$inferInsert> = {}) =>
        ins((tx) => tx.insert(schema.products).values({ businessId: biz, name, priceCents: 1000, trackStock: true, costCents: 400, ...extra }).returning()).then((r) => r[0]!);
      const p1 = await mk("Shampoo");
      const p2 = await mk("Conditioner");
      const p3 = await mk("Low thing", { supplierId: sup!.id, lowStockThreshold: 5, reorderUpTo: 10, costCents: 250 });
      const [co] = await ins((tx) => tx.insert(schema.clients).values({ businessId: biz, firstName: "Pat" }).returning());
      const [appt] = await ins((tx) => tx.insert(schema.appointments).values({ businessId: biz, clientId: co!.id, locationId: loc!.id }).returning());
      const [po] = await ins((tx) => tx.insert(schema.purchaseOrders).values({ businessId: biz, number: 1, supplierId: sup!.id, locationId: loc!.id }).returning());
      await ins((tx) => tx.insert(schema.purchaseOrderLines).values({ businessId: biz, purchaseOrderId: po!.id, productId: p1.id, orderedQty: 5, unitCostCents: 300 }));
      Object.assign(ids, { [`loc${biz}`]: loc!.id, [`loc2${biz}`]: loc2!.id, [`sup${biz}`]: sup!.id, [`p1${biz}`]: p1.id, [`p2${biz}`]: p2.id, [`p3${biz}`]: p3.id, [`appt${biz}`]: appt!.id, [`po${biz}`]: po!.id });
    }
  });
  afterAll(async () => {
    if (kit) await kit.teardown();
  });

  const A = () => kit.A;
  const B = () => kit.B;
  const id = (k: string) => ids[`${k}${kit.A}`]!;
  const bid = (k: string) => ids[`${k}${kit.B}`]!;
  const stockOf = async (biz: string, productId: string) => (await withTenant(biz, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId), columns: { stockQty: true } })))?.stockQty;
  const atLoc = async (biz: string, productId: string, locationId: string) =>
    (await withTenant(biz, (tx) => tx.select().from(schema.productStock).where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, locationId)))))[0]?.qty ?? 0;
  const moves = (biz: string, productId: string) => withTenant(biz, (tx) => tx.select().from(schema.stockMovements).where(eq(schema.stockMovements.productId, productId)));

  describe("receiving stock", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("receives one product, then a batch, at the named location (the main one when none is named)", async () => {
      const r = await call(postReceipt, key, noParams, send("POST", { items: [{ product_id: id("p1"), quantity: 10 }], note: "Delivery" }));
      expect(r.status).toBe(201);
      expect((await r.json()).data).toMatchObject({ units: 10, products: 1 });
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(10);
      const b = await call(postReceipt, key, noParams, send("POST", { location_id: id("loc2"), items: [{ product_id: id("p1"), quantity: 3 }, { product_id: id("p2"), quantity: 7 }] }));
      expect(b.status).toBe(201);
      expect((await b.json()).data).toMatchObject({ units: 10, products: 2 });
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(3);
      expect(await atLoc(A(), id("p2"), id("loc2"))).toBe(7);
      expect(await stockOf(A(), id("p1"))).toBe(13);
      expect((await moves(A(), id("p1"))).every((m) => m.reason === "received" && m.createdByUserId?.startsWith("api:"))).toBe(true);
    });
    it("reads stock per location", async () => {
      const d = (await (await call(getStock, key, { id: id("p1") })).json()).data;
      expect(d).toMatchObject({ product_id: id("p1"), on_hand: 13 });
      expect(d.locations.map((l: { name: string; qty: number }) => [l.name, l.qty])).toEqual([["Main", 10], ["Second", 3]]);
    });
    it("validates (422) and checks scopes (403)", async () => {
      for (const bad of [{ items: [] }, { items: [{ product_id: id("p1"), quantity: 0 }] }, { items: [{ product_id: id("p1"), quantity: 1.5 }] }, { items: [{ product_id: id("p1"), quantity: 1, price: 1 }] }, { items: [{ product_id: id("p1"), quantity: 1 }], bogus: 1 }, {}]) {
        expect((await call(postReceipt, key, noParams, send("POST", bad))).status).toBe(422);
      }
      expect((await call(postReceipt, readKey, noParams, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(403);
      expect((await call(postReceipt, otherScope, noParams, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(403);
      expect((await call(getStock, otherScope, { id: id("p1") })).status).toBe(403);
      expect((await call(getStock, readKey, { id: id("p1") })).status).toBe(200);
    });
    it("rejects another business's product or location, in the body or the URL, and changes nothing", async () => {
      const before = (await moves(B(), bid("p1"))).length;
      // One good item and one foreign: nothing is applied.
      expect((await call(postReceipt, key, noParams, send("POST", { items: [{ product_id: id("p2"), quantity: 1 }, { product_id: bid("p1"), quantity: 99 }] }))).status).toBe(404);
      expect((await call(postReceipt, key, noParams, send("POST", { location_id: bid("loc"), items: [{ product_id: id("p2"), quantity: 1 }] }))).status).toBe(404);
      expect((await call(getStock, key, { id: bid("p1") })).status).toBe(404);
      expect(await stockOf(B(), bid("p1"))).toBe(0);
      expect((await moves(B(), bid("p1"))).length).toBe(before);
      expect(await stockOf(A(), id("p2"))).toBe(7);
    });
    it("undoes a delivery once; refuses when some of it has gone; another business's movement is a 404", async () => {
      await call(postReceipt, key, noParams, send("POST", { items: [{ product_id: id("p2"), quantity: 5 }], note: "Oops" }));
      const m = (await moves(A(), id("p2"))).find((x) => x.note === "Oops")!;
      expect((await call(undoReceipt, key, { id: m.id }, send("POST"))).status).toBe(200);
      expect(await atLoc(A(), id("p2"), id("loc"))).toBe(0);
      expect((await call(undoReceipt, key, { id: m.id }, send("POST"))).status).toBe(409);
      // Receive 4 at Main, use 3, then it cannot be undone.
      await call(postReceipt, key, noParams, send("POST", { items: [{ product_id: id("p2"), quantity: 4 }], note: "Used up" }));
      await call(postUsage, key, noParams, send("POST", { items: [{ product_id: id("p2"), quantity: 3 }] }));
      const m2 = (await moves(A(), id("p2"))).find((x) => x.note === "Used up")!;
      const refused = await call(undoReceipt, key, { id: m2.id }, send("POST"));
      expect(refused.status).toBe(409);
      expect(await atLoc(A(), id("p2"), id("loc"))).toBe(1);
      const theirs = await withTenant(B(), (tx) => tx.insert(schema.stockMovements).values({ businessId: B(), productId: bid("p1"), delta: 5, reason: "received", locationId: bid("loc") }).returning());
      expect((await call(undoReceipt, key, { id: theirs[0]!.id }, send("POST"))).status).toBe(404);
      expect((await call(undoReceipt, readKey, { id: m.id }, send("POST"))).status).toBe(403);
      expect((await withTenant(B(), (tx) => tx.select().from(schema.stockMovements).where(eq(schema.stockMovements.id, theirs[0]!.id)))).length).toBe(1);
    });
    it("keeps the existing stock-adjustment and movement endpoints working", async () => {
      expect((await call(stockAdjust, key, { id: id("p1") }, send("POST", { reason: "damage", quantity: 1, location_id: id("loc") }))).status).toBe(201);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(9);
      expect((await call(stockMoves, readKey, { id: id("p1") })).status).toBe(200);
    });
  });

  describe("counts and transfers", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("a count corrects only the products that differ, and writes a count movement", async () => {
      const r = await call(postCount, key, noParams, send("POST", { location_id: id("loc2"), note: "Shelf check", counts: [{ product_id: id("p1"), counted: 3 }, { product_id: id("p2"), counted: 10 }] }));
      expect(r.status).toBe(201);
      expect((await r.json()).data).toEqual({ counted: 2, changed: 1, units_off: 3 });
      expect(await atLoc(A(), id("p2"), id("loc2"))).toBe(10);
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(3);
      expect((await moves(A(), id("p2"))).filter((m) => m.reason === "count")).toHaveLength(1);
      expect(await stockOf(A(), id("p2"))).toBe(11);
    });
    it("a product left out of the count is not touched", async () => {
      const before = await stockOf(A(), id("p3"));
      await call(postCount, key, noParams, send("POST", { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: 9 }] }));
      expect(await stockOf(A(), id("p3"))).toBe(before);
    });
    it("validates counts (422), refuses duplicates, and needs inventory:write (403)", async () => {
      for (const bad of [{ location_id: id("loc"), counts: [] }, { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: -1 }] }, { counts: [{ product_id: id("p1"), counted: 1 }] }, { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: 1 }, { product_id: id("p1"), counted: 2 }] }, { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: 1 }], x: 1 }]) {
        expect((await call(postCount, key, noParams, send("POST", bad))).status).toBe(422);
      }
      expect((await call(postCount, readKey, noParams, send("POST", { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: 1 }] }))).status).toBe(403);
    });
    it("rejects another business's location or product in the body (404) and counts nothing", async () => {
      expect((await call(postCount, key, noParams, send("POST", { location_id: bid("loc"), counts: [{ product_id: id("p1"), counted: 50 }] }))).status).toBe(404);
      expect((await call(postCount, key, noParams, send("POST", { location_id: id("loc"), counts: [{ product_id: id("p1"), counted: 50 }, { product_id: bid("p1"), counted: 50 }] }))).status).toBe(404);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(9);
      expect(await stockOf(B(), bid("p1"))).toBe(0);
    });
    it("transfers between locations; the total stays, the source cannot go below zero", async () => {
      const total = await stockOf(A(), id("p1"));
      const r = await call(postTransfer, key, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc"), to_location_id: id("loc2"), quantity: 4, note: "Restock" }));
      expect(r.status).toBe(201);
      expect((await r.json()).data.locations.map((l: { qty: number }) => l.qty)).toEqual([5, 7]);
      expect(await stockOf(A(), id("p1"))).toBe(total);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(5);
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(7);
      expect((await call(postTransfer, key, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc"), to_location_id: id("loc2"), quantity: 500 }))).status).toBe(409);
      expect((await call(postTransfer, key, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc"), to_location_id: id("loc"), quantity: 1 }))).status).toBe(409);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(5);
    });
    it("rejects foreign ids on transfers (404) and bad bodies (422)", async () => {
      for (const bad of [{ product_id: bid("p1"), from_location_id: id("loc"), to_location_id: id("loc2"), quantity: 1 }, { product_id: id("p1"), from_location_id: bid("loc"), to_location_id: id("loc2"), quantity: 1 }, { product_id: id("p1"), from_location_id: id("loc"), to_location_id: bid("loc"), quantity: 1 }]) {
        expect((await call(postTransfer, key, noParams, send("POST", bad))).status).toBe(404);
      }
      expect((await call(postTransfer, key, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc"), to_location_id: id("loc2"), quantity: 0 }))).status).toBe(422);
      expect((await call(postTransfer, key, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc") }))).status).toBe(422);
      expect((await call(postTransfer, readKey, noParams, send("POST", { product_id: id("p1"), from_location_id: id("loc"), to_location_id: id("loc2"), quantity: 1 }))).status).toBe(403);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(5);
      expect(await stockOf(B(), bid("p1"))).toBe(0);
    });
  });

  describe("supplies used", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("logs supplies on a visit, reads them back, and takes them back", async () => {
      const before = await atLoc(A(), id("p1"), id("loc"));
      const r = await call(postSupplies, key, { id: id("appt") }, send("POST", { items: [{ product_id: id("p1"), quantity: 2 }] }));
      expect(r.status).toBe(201);
      expect((await r.json()).data.units).toBe(2);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(before - 2); // the visit's location
      const got = (await (await call(getSupplies, readKey, { id: id("appt") })).json()).data;
      expect(got).toEqual([{ product_id: id("p1"), label: "Shampoo", quantity: 2 }]);
      expect((await call(deleteSupplies, key, { id: id("appt"), productId: id("p1") }, send("DELETE"), url("quantity=1"))).status).toBe(200);
      expect((await (await call(getSupplies, readKey, { id: id("appt") })).json()).data[0].quantity).toBe(1);
      expect((await call(deleteSupplies, key, { id: id("appt"), productId: id("p1") }, send("DELETE"))).status).toBe(200); // the rest
      expect((await (await call(getSupplies, readKey, { id: id("appt") })).json()).data).toEqual([]);
      expect(await atLoc(A(), id("p1"), id("loc"))).toBe(before);
      expect((await call(deleteSupplies, key, { id: id("appt"), productId: id("p1") }, send("DELETE"))).status).toBe(409); // nothing left to take back
    });
    it("may take a count below zero rather than stop the work (the app's rule)", async () => {
      expect((await call(postSupplies, key, { id: id("appt") }, send("POST", { items: [{ product_id: id("p3"), quantity: 5 }] }))).status).toBe(201);
      expect(await atLoc(A(), id("p3"), id("loc"))).toBe(-5);
      await call(deleteSupplies, key, { id: id("appt"), productId: id("p3") }, send("DELETE"));
    });
    it("rejects foreign appointments and products, bad bodies and scopes, and changes nothing", async () => {
      expect((await call(postSupplies, key, { id: bid("appt") }, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(404);
      expect((await call(getSupplies, key, { id: bid("appt") })).status).toBe(404);
      expect((await call(postSupplies, key, { id: id("appt") }, send("POST", { items: [{ product_id: bid("p1"), quantity: 1 }] }))).status).toBe(404);
      expect((await call(deleteSupplies, key, { id: id("appt"), productId: bid("p1") }, send("DELETE"))).status).toBe(404);
      expect((await call(deleteSupplies, key, { id: bid("appt"), productId: id("p1") }, send("DELETE"))).status).toBe(404);
      expect((await call(postSupplies, key, { id: id("appt") }, send("POST", { items: [] }))).status).toBe(422);
      expect((await call(postSupplies, key, { id: id("appt") }, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }, { product_id: id("p1"), quantity: 1 }] }))).status).toBe(422);
      expect((await call(deleteSupplies, key, { id: id("appt"), productId: id("p1") }, send("DELETE"), url("quantity=0"))).status).toBe(422);
      expect((await call(postSupplies, readKey, { id: id("appt") }, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(403);
      expect((await call(getSupplies, otherScope, { id: id("appt") })).status).toBe(403);
      expect(await stockOf(B(), bid("p1"))).toBe(0);
    });
    it("logs usage without a visit and takes it back once (another business's movement is a 404)", async () => {
      const before = await atLoc(A(), id("p1"), id("loc2"));
      const r = await call(postUsage, key, noParams, send("POST", { location_id: id("loc2"), items: [{ product_id: id("p1"), quantity: 2 }], note: "Back bar" }));
      expect(r.status).toBe(201);
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(before - 2);
      const m = (await moves(A(), id("p1"))).find((x) => x.note === "Back bar")!;
      expect((await call(undoUsage, key, { id: m.id }, send("POST"))).status).toBe(200);
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(before);
      expect((await call(undoUsage, key, { id: m.id }, send("POST"))).status).toBe(409);
      const theirs = await withTenant(B(), (tx) => tx.insert(schema.stockMovements).values({ businessId: B(), productId: bid("p1"), delta: -1, reason: "used", locationId: bid("loc") }).returning());
      expect((await call(undoUsage, key, { id: theirs[0]!.id }, send("POST"))).status).toBe(404);
      expect((await call(postUsage, key, noParams, send("POST", { location_id: bid("loc"), items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(404);
      expect((await call(postUsage, key, noParams, send("POST", { items: [{ product_id: id("p1"), quantity: 0 }] }))).status).toBe(422);
      expect((await call(postUsage, readKey, noParams, send("POST", { items: [{ product_id: id("p1"), quantity: 1 }] }))).status).toBe(403);
      expect((await call(undoUsage, readKey, { id: m.id }, send("POST"))).status).toBe(403);
    });
  });

  describe("reorder suggestions and the inventory list", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("suggests what to order, grouped by supplier and location, and only for this business", async () => {
      const d = (await (await call(reorder, readKey)).json()).data;
      const mine = d.flatMap((g: { items: { product_id: string }[] }) => g.items.map((i) => i.product_id));
      expect(mine).toContain(id("p3"));
      expect(mine).not.toContain(bid("p3"));
      const g = d.find((x: { items: { product_id: string }[] }) => x.items.some((i) => i.product_id === id("p3")));
      expect(g).toMatchObject({ supplier_id: id("sup"), supplier_name: "Acme", location_id: id("loc") });
      expect(g.items.find((i: { product_id: string }) => i.product_id === id("p3"))).toMatchObject({ on_hand: 0, suggested_qty: 10, unit_cost_cents: 250 });
      expect((await call(reorder, otherScope)).status).toBe(403);
    });
    it("lists tracked products with inventory settings; the existing fields are intact", async () => {
      const d = (await (await call(listInventory, readKey)).json()).data;
      const row = d.find((x: { product_id: string }) => x.product_id === id("p3"));
      expect(row).toMatchObject({ name: "Low thing", on_hand: 0, low_stock_threshold: 5, is_low: true, reorder_up_to: 10, supplier_id: id("sup"), cost_cents: 250, kind: "retail" });
      expect(d.map((x: { product_id: string }) => x.product_id)).not.toContain(bid("p1"));
    });
  });

  describe("suppliers", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("creates, reads, lists and hides a supplier", async () => {
      const r = await call(postSupplier, key, noParams, send("POST", { name: "Beauty Co", contact_name: "Lee", email: "Lee@Example.com", phone: "555-1", account_number: "A-9", notes: "net 30" }));
      expect(r.status).toBe(201);
      const s = (await r.json()).data;
      expect(s).toMatchObject({ name: "Beauty Co", contact_name: "Lee", email: "lee@example.com", account_number: "A-9", active: true });
      ids.newSupplier = s.id;
      expect((await (await call(getSupplier, readKey, { id: s.id })).json()).data.name).toBe("Beauty Co");
      expect((await (await call(listSuppliers, readKey)).json()).data.map((x: { id: string }) => x.id)).toContain(s.id);
      expect((await call(patchSupplier, key, { id: s.id }, send("PATCH", { active: false }))).status).toBe(200);
      expect((await (await call(listSuppliers, readKey)).json()).data.map((x: { id: string }) => x.id)).not.toContain(s.id);
      expect((await (await call(listSuppliers, readKey, noParams, {}, url("include_inactive=1"))).json()).data.map((x: { id: string }) => x.id)).toContain(s.id);
      await call(patchSupplier, key, { id: s.id }, send("PATCH", { active: true }));
      expect((await withTenant(A(), (tx) => tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, s.id) })))).toMatchObject({ active: true, name: "Beauty Co", notes: "net 30" });
    });
    it("PATCH changes only what is sent; null clears", async () => {
      expect((await call(patchSupplier, key, { id: id("sup") }, send("PATCH", { name: "Acme Ltd" }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id("sup")) }))).toMatchObject({ name: "Acme Ltd", notes: "keep me", phone: "555", active: true });
      expect((await call(patchSupplier, key, { id: id("sup") }, send("PATCH", { phone: null }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, id("sup")) }))).toMatchObject({ phone: null, notes: "keep me" });
      expect((await call(patchSupplier, key, { id: id("sup") }, send("PATCH", {}))).status).toBe(200);
    });
    it("validates (422), refuses foreign ids (404, untouched) and checks scopes (403)", async () => {
      for (const bad of [{}, { name: "" }, { name: "X", email: "nope" }, { name: "X", rating: 5 }]) expect((await call(postSupplier, key, noParams, send("POST", bad))).status).toBe(422);
      expect((await call(patchSupplier, key, { id: id("sup") }, send("PATCH", { name: "" }))).status).toBe(422);
      expect((await call(getSupplier, key, { id: bid("sup") })).status).toBe(404);
      expect((await call(patchSupplier, key, { id: bid("sup") }, send("PATCH", { name: "Hacked", active: false }))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.suppliers.findFirst({ where: eq(schema.suppliers.id, bid("sup")) }))).toMatchObject({ name: "Acme", active: true });
      expect((await call(postSupplier, readKey, noParams, send("POST", { name: "X" }))).status).toBe(403);
      expect((await call(patchSupplier, readKey, { id: id("sup") }, send("PATCH", { name: "X" }))).status).toBe(403);
      expect((await call(getSupplier, otherScope, { id: id("sup") })).status).toBe(403);
    });
  });

  describe("purchase orders", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["inventory:write"]);
    });
    it("creates a draft with lines (cost defaults to the product's), and reads it back", async () => {
      const r = await call(postOrder, key, noParams, send("POST", { supplier_id: id("sup"), location_id: id("loc2"), expected_on: "2026-12-01", notes: "Rush", lines: [{ product_id: id("p1"), quantity: 6 }, { product_id: id("p2"), quantity: 4, unit_cost_cents: 123 }] }));
      expect(r.status).toBe(201);
      const po = (await r.json()).data;
      expect(po).toMatchObject({ number: 2, status: "draft", supplier_id: id("sup"), location_id: id("loc2"), expected_on: "2026-12-01", notes: "Rush", supplier_name: "Acme Ltd", location_name: "Second" });
      expect(po.lines.map((l: { product_id: string; ordered_qty: number; unit_cost_cents: number }) => [l.product_id, l.ordered_qty, l.unit_cost_cents]).sort()).toEqual([[id("p1"), 6, 400], [id("p2"), 4, 123]].sort());
      ids.po = po.id;
      expect((await (await call(getOrder, readKey, { id: po.id })).json()).data.number).toBe(2);
      const open = (await (await call(listOrders, readKey)).json()).data;
      expect(open.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([po.id, id("po")]));
      expect(open.find((x: { id: string }) => x.id === po.id)).toMatchObject({ units: 10, received_units: 0, cost_cents: 6 * 400 + 4 * 123 });
      expect(open.map((x: { id: string }) => x.id)).not.toContain(bid("po"));
    });
    it("PATCH leaves omitted fields alone", async () => {
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { reference: "INV-77" }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, ids.po!) }))).toMatchObject({ reference: "INV-77", notes: "Rush", expectedOn: "2026-12-01", supplierId: id("sup"), locationId: id("loc2") });
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { expected_on: null, notes: null }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, ids.po!) }))).toMatchObject({ expectedOn: null, notes: null, reference: "INV-77" });
    });
    it("adds, changes and removes lines", async () => {
      expect((await call(addLine, key, { id: ids.po! }, send("POST", { product_id: id("p3"), quantity: 8 }))).status).toBe(201);
      expect((await call(patchLine, key, { id: ids.po!, productId: id("p3") }, send("PATCH", { quantity: 9, unit_cost_cents: 200 }))).status).toBe(200);
      let line = (await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrderLines).where(and(eq(schema.purchaseOrderLines.purchaseOrderId, ids.po!), eq(schema.purchaseOrderLines.productId, id("p3"))))))[0]!;
      expect(line).toMatchObject({ orderedQty: 9, unitCostCents: 200 });
      expect((await call(patchLine, key, { id: ids.po!, productId: id("p3") }, send("PATCH", { quantity: 12 }))).status).toBe(200);
      line = (await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrderLines).where(and(eq(schema.purchaseOrderLines.purchaseOrderId, ids.po!), eq(schema.purchaseOrderLines.productId, id("p3"))))))[0]!;
      expect(line).toMatchObject({ orderedQty: 12, unitCostCents: 200 }); // the cost stays when only the quantity is sent
      expect((await call(deleteLine, key, { id: ids.po!, productId: id("p3") }, send("DELETE"))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrderLines).where(and(eq(schema.purchaseOrderLines.purchaseOrderId, ids.po!), eq(schema.purchaseOrderLines.productId, id("p3")))))).toHaveLength(0);
      expect((await call(deleteLine, key, { id: ids.po!, productId: id("p3") }, send("DELETE"))).status).toBe(404);
      expect((await call(patchLine, key, { id: ids.po!, productId: id("p3") }, send("PATCH", { quantity: 1 }))).status).toBe(404);
    });
    it("rejects foreign suppliers, locations, products and lines in the body (404, nothing created or changed)", async () => {
      const count = async () => (await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrders))).length;
      const n = await count();
      expect((await call(postOrder, key, noParams, send("POST", { supplier_id: bid("sup") }))).status).toBe(404);
      expect((await call(postOrder, key, noParams, send("POST", { location_id: bid("loc") }))).status).toBe(404);
      expect((await call(postOrder, key, noParams, send("POST", { lines: [{ product_id: bid("p1"), quantity: 1 }] }))).status).toBe(404);
      expect(await count()).toBe(n);
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { supplier_id: bid("sup") }))).status).toBe(404);
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { location_id: bid("loc") }))).status).toBe(404);
      expect((await call(addLine, key, { id: ids.po! }, send("POST", { product_id: bid("p1"), quantity: 1 }))).status).toBe(404);
      expect((await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, ids.po!) })))?.supplierId).toBe(id("sup"));
    });
    it("answers 404 for another business's order on every route and leaves it untouched", async () => {
      const o = bid("po");
      const lineB = (await withTenant(B(), (tx) => tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, o))))[0]!;
      expect((await call(getOrder, key, { id: o })).status).toBe(404);
      expect((await call(patchOrder, key, { id: o }, send("PATCH", { notes: "Hacked" }))).status).toBe(404);
      expect((await call(addLine, key, { id: o }, send("POST", { product_id: id("p1"), quantity: 1 }))).status).toBe(404);
      expect((await call(patchLine, key, { id: o, productId: bid("p1") }, send("PATCH", { quantity: 99 }))).status).toBe(404);
      expect((await call(deleteLine, key, { id: o, productId: bid("p1") }, send("DELETE"))).status).toBe(404);
      expect((await call(markOrdered, key, { id: o }, send("POST"))).status).toBe(404);
      expect((await call(cancelOrder, key, { id: o }, send("POST"))).status).toBe(404);
      expect((await call(receiveOrder, key, { id: o }, send("POST", { lines: [{ line_id: lineB.id, quantity: 5 }] }))).status).toBe(404);
      const after = await withTenant(B(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, o) }));
      expect(after).toMatchObject({ status: "draft", notes: null });
      expect((await withTenant(B(), (tx) => tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.id, lineB.id))))[0]).toMatchObject({ orderedQty: 5, receivedQty: 0 });
      expect(await stockOf(B(), bid("p1"))).toBe(0);
    });
    it("orders, receives part of it (stock and cost update), then the rest (the order completes)", async () => {
      expect((await call(markOrdered, key, { id: ids.po! }, send("POST"))).status).toBe(200);
      expect((await call(markOrdered, key, { id: ids.po! }, send("POST"))).status).toBe(409); // already ordered
      const lines = (await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, ids.po!))));
      const l1 = lines.find((l) => l.productId === id("p1"))!;
      const l2 = lines.find((l) => l.productId === id("p2"))!;
      const before = await atLoc(A(), id("p1"), id("loc2"));
      const r1 = await call(receiveOrder, key, { id: ids.po! }, send("POST", { reference: "DEL-1", lines: [{ line_id: l1.id, quantity: 6, unit_cost_cents: 450 }] }));
      expect(r1.status).toBe(201);
      const d1 = (await r1.json()).data;
      expect(d1).toMatchObject({ units: 6, done: false });
      expect(d1.order.status).toBe("partial");
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(before + 6); // the order's own location
      expect((await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, id("p1")) })))?.costCents).toBe(450);
      expect(d1.order.receipts).toHaveLength(1);
      const r2 = await call(receiveOrder, key, { id: ids.po! }, send("POST", { lines: [{ line_id: l2.id, quantity: 4 }] }));
      expect((await r2.json()).data).toMatchObject({ units: 4, done: true });
      const final = await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, ids.po!) }));
      expect(final).toMatchObject({ status: "received", reference: "DEL-1" });
      // A closed order cannot change or be cancelled (409), and a delivery on it can be undone from the stock endpoint.
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { notes: "late" }))).status).toBe(409);
      expect((await call(cancelOrder, key, { id: ids.po! }, send("POST"))).status).toBe(409);
      expect((await call(addLine, key, { id: ids.po! }, send("POST", { product_id: id("p3"), quantity: 1 }))).status).toBe(409);
      const m = (await moves(A(), id("p1"))).find((x) => x.purchaseOrderId === ids.po && x.delta === 6)!;
      expect((await call(undoReceipt, key, { id: m.id }, send("POST"))).status).toBe(200);
      expect(await atLoc(A(), id("p1"), id("loc2"))).toBe(before);
      expect((await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, ids.po!) })))?.status).toBe("partial");
      expect((await (await call(listOrders, readKey, noParams, {}, url("status=received"))).json()).data.map((x: { id: string }) => x.id)).not.toContain(ids.po);
      expect((await (await call(listOrders, readKey, noParams, {}, url("status=all"))).json()).data.map((x: { id: string }) => x.id)).toContain(ids.po);
    });
    it("receive validates lines: a line of another order is a 404, bad numbers a 422, and an order with nothing on it cannot be marked ordered (409)", async () => {
      const other = (await (await call(postOrder, key, noParams, send("POST", {}))).json()).data;
      expect((await call(markOrdered, key, { id: other.id }, send("POST"))).status).toBe(409);
      const mine = (await withTenant(A(), (tx) => tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, ids.po!))))[0]!;
      expect((await call(receiveOrder, key, { id: other.id }, send("POST", { lines: [{ line_id: mine.id, quantity: 1 }] }))).status).toBe(404);
      expect((await call(receiveOrder, key, { id: other.id }, send("POST", { lines: [{ line_id: mine.id, quantity: 0 }] }))).status).toBe(422);
      expect((await call(receiveOrder, key, { id: other.id }, send("POST", { lines: [] }))).status).toBe(422);
      expect((await call(receiveOrder, key, { id: other.id }, send("POST", { lines: [{ line_id: mine.id, quantity: 1 }, { line_id: mine.id, quantity: 1 }] }))).status).toBe(422);
      expect((await call(cancelOrder, key, { id: other.id }, send("POST"))).status).toBe(200);
      expect((await withTenant(A(), (tx) => tx.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, other.id) })))?.status).toBe("cancelled");
      expect((await call(cancelOrder, key, { id: other.id }, send("POST"))).status).toBe(409);
    });
    it("validates bodies (422) and checks scopes (403)", async () => {
      for (const bad of [{ expected_on: "tomorrow" }, { notes: "x".repeat(501) }, { lines: [{ product_id: id("p1"), quantity: 0 }] }, { lines: [{ product_id: id("p1"), quantity: 1 }, { product_id: id("p1"), quantity: 2 }] }, { bogus: 1 }]) {
        expect((await call(postOrder, key, noParams, send("POST", bad))).status).toBe(422);
      }
      expect((await call(listOrders, readKey, noParams, {}, url("status=weird"))).status).toBe(422);
      expect((await call(patchOrder, key, { id: ids.po! }, send("PATCH", { status: "received" }))).status).toBe(422);
      expect((await call(postOrder, readKey, noParams, send("POST", {}))).status).toBe(403);
      for (const h of [patchOrder, addLine, markOrdered, receiveOrder, cancelOrder]) expect((await call(h as never, readKey, { id: ids.po! } as never, send("POST", {}))).status).toBe(403);
      expect((await call(getOrder, otherScope, { id: ids.po! })).status).toBe(403);
      expect((await call(listOrders, otherScope)).status).toBe(403);
    });
  });

  it("every write above left an audit row", async () => {
    const rows = await withTenant(A(), (tx) => tx.select({ a: schema.auditLog.action }).from(schema.auditLog));
    const actions = new Set(rows.map((r) => r.a));
    for (const a of ["api.stock.receive", "api.stock.undo_receipt", "api.stock.count", "api.stock.transfer", "api.stock.log_usage", "api.stock.undo_usage", "api.stock.undo_visit_supplies", "api.supplier.create", "api.supplier.update", "api.purchase_order.create", "api.purchase_order.update", "api.purchase_order.line_set", "api.purchase_order.line_remove", "api.purchase_order.receive"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});
