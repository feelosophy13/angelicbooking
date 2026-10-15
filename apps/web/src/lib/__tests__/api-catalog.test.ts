/**
 * Integration test: the catalog half of the admin-parity API (categories, service order and per-stylist terms, packages, membership plans,
 * product groups, extra barcodes, product extras). Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 * Nothing here calls a third party or sends a message.
 */
// The env import must come first: @angelic/db connects when it is imported, and without DATABASE_URL it falls back to a superuser connection that skips row-level security.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

import { GET as listCats, POST as postCat } from "@/app/api/v1/categories/route";
import { GET as getCat, PATCH as patchCat, DELETE as delCat } from "@/app/api/v1/categories/[id]/route";
import { POST as moveCat } from "@/app/api/v1/categories/[id]/move/route";
import { POST as moveSvc } from "@/app/api/v1/services/[id]/move/route";
import { GET as getSvcStaff, PUT as putSvcStaff } from "@/app/api/v1/services/[id]/staff/route";
import { GET as listPkgs, POST as postPkg } from "@/app/api/v1/packages/route";
import { GET as getPkg, PATCH as patchPkg } from "@/app/api/v1/packages/[id]/route";
import { GET as listPlans, POST as postPlan } from "@/app/api/v1/membership-plans/route";
import { GET as getPlan, PATCH as patchPlan } from "@/app/api/v1/membership-plans/[id]/route";
import { POST as postProduct } from "@/app/api/v1/products/route";
import { PATCH as patchProduct } from "@/app/api/v1/products/[id]/route";
import { GET as listGroups, POST as postGroup } from "@/app/api/v1/product-groups/route";
import { GET as getGroup, PATCH as patchGroup } from "@/app/api/v1/product-groups/[id]/route";
import { POST as addOptions } from "@/app/api/v1/product-groups/[id]/options/route";
import { POST as convert } from "@/app/api/v1/products/[id]/convert-to-group/route";
import { GET as listCodes, POST as postCode } from "@/app/api/v1/products/[id]/barcodes/route";
import { DELETE as delCode } from "@/app/api/v1/products/[id]/barcodes/[barcodeId]/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let key: string; // catalog:write, a fresh one per block (the API allows 120 requests a minute per key)
let readKey: string; // catalog:read only
let otherScope: string; // a scope that is not catalog:*
const ids: Record<string, string> = {};
const noParams = {} as Record<string, never>;
const q = (kind: string) => `http://x/api/v1/t?kind=${kind}`;

describe.skipIf(!up)("API: catalog", () => {
  beforeAll(async () => {
    kit = await setupKit(["catalog:write"]);
    readKey = await mkKey(kit.A, ["catalog:read"]);
    otherScope = await mkKey(kit.A, ["clients:write"]);
    for (const biz of [kit.A, kit.B]) {
      const ins = <T,>(f: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(biz, f);
      const [loc] = await ins((tx) => tx.insert(schema.locations).values({ businessId: biz, name: "Main", isDefault: true }).returning());
      const [loc2] = await ins((tx) => tx.insert(schema.locations).values({ businessId: biz, name: "Second" }).returning());
      const [svcCat] = await ins((tx) => tx.insert(schema.serviceCategories).values({ businessId: biz, name: `Hair ${biz}`, sortOrder: 0 }).returning());
      const [svcCat2] = await ins((tx) => tx.insert(schema.serviceCategories).values({ businessId: biz, name: `Nails ${biz}`, sortOrder: 1 }).returning());
      const [prodCat] = await ins((tx) => tx.insert(schema.productCategories).values({ businessId: biz, name: `Care ${biz}`, sortOrder: 0 }).returning());
      const [s1] = await ins((tx) => tx.insert(schema.services).values({ businessId: biz, name: "Cut", durationMin: 30, priceCents: 5000, categoryId: svcCat!.id, sortOrder: 0 }).returning());
      const [s2] = await ins((tx) => tx.insert(schema.services).values({ businessId: biz, name: "Style", durationMin: 45, priceCents: 7000, categoryId: svcCat!.id, sortOrder: 1 }).returning());
      const [st] = await ins((tx) => tx.insert(schema.staff).values({ businessId: biz, displayName: `Stylist ${biz}` }).returning());
      const [st2] = await ins((tx) => tx.insert(schema.staff).values({ businessId: biz, displayName: `Second ${biz}` }).returning());
      const [pkg] = await ins((tx) => tx.insert(schema.packages).values({ businessId: biz, name: "5 cuts", sessions: 5, priceCents: 20000, serviceId: s1!.id, description: "keep me" }).returning());
      const [plan] = await ins((tx) => tx.insert(schema.membershipPlans).values({ businessId: biz, name: "Gold", priceCents: 9900, description: "keep me", stripePriceId: "price_x" }).returning());
      const [sup] = await ins((tx) => tx.insert(schema.suppliers).values({ businessId: biz, name: "Acme" }).returning());
      const [prod] = await ins((tx) => tx.insert(schema.products).values({ businessId: biz, name: "Shampoo", priceCents: 1800, sku: `SKU-${biz}`, barcode: `BAR-${biz}`, categoryId: prodCat!.id }).returning());
      Object.assign(ids, {
        [`loc${biz}`]: loc!.id, [`loc2${biz}`]: loc2!.id, [`svcCat${biz}`]: svcCat!.id, [`svcCat2${biz}`]: svcCat2!.id, [`prodCat${biz}`]: prodCat!.id,
        [`s1${biz}`]: s1!.id, [`s2${biz}`]: s2!.id, [`st${biz}`]: st!.id, [`st2${biz}`]: st2!.id, [`pkg${biz}`]: pkg!.id, [`plan${biz}`]: plan!.id, [`sup${biz}`]: sup!.id, [`prod${biz}`]: prod!.id,
      });
    }
  });
  afterAll(async () => {
    if (kit) await kit.teardown();
  });

  const A = () => kit.A;
  const B = () => kit.B;
  const id = (k: string) => ids[`${k}${kit.A}`]!;
  const bid = (k: string) => ids[`${k}${kit.B}`]!;

  describe("categories", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("creates, nests, reads and lists a service category", async () => {
      const r = await call(postCat, key, noParams, send("POST", { kind: "service", name: "Colour", description: "All colour", prep_notes: "Come with dry hair", parent_id: id("svcCat") }));
      expect(r.status).toBe(201);
      const c = (await r.json()).data;
      expect(c).toMatchObject({ name: "Colour", parent_id: id("svcCat"), description: "All colour", prep_notes: "Come with dry hair" });
      ids.newCat = c.id;
      expect((await (await call(getCat, key, { id: c.id }, {}, q("service"))).json()).data.name).toBe("Colour");
      const list = (await (await call(listCats, key, noParams, {}, q("service"))).json()).data;
      expect(list.map((x: { id: string }) => x.id)).toContain(c.id);
      expect(list.every((x: { id: string }) => x.id !== bid("svcCat"))).toBe(true);
    });
    it("creates a flat product category", async () => {
      const r = await call(postCat, key, noParams, send("POST", { kind: "product", name: "Styling" }));
      expect(r.status).toBe(201);
      ids.newProdCat = (await r.json()).data.id;
    });
    it("refuses duplicates (409), product categories with a parent (422), a bad kind (422), and unknown fields (422)", async () => {
      expect((await call(postCat, key, noParams, send("POST", { kind: "service", name: "colour", parent_id: id("svcCat") }))).status).toBe(409);
      expect((await call(postCat, key, noParams, send("POST", { kind: "product", name: "X", parent_id: id("svcCat") }))).status).toBe(422);
      expect((await call(postCat, key, noParams, send("POST", { kind: "other", name: "X" }))).status).toBe(422);
      expect((await call(postCat, key, noParams, send("POST", { kind: "service", name: "X", sort_order: 3 }))).status).toBe(422);
      expect((await call(postCat, key, noParams, send("POST", { kind: "service", name: "" }))).status).toBe(422);
      expect((await call(listCats, key, noParams, {}, q("nope"))).status).toBe(422);
    });
    it("rejects another business's parent id in the body with 404 and creates nothing", async () => {
      const before = await withTenant(A(), (tx) => tx.select().from(schema.serviceCategories));
      expect((await call(postCat, key, noParams, send("POST", { kind: "service", name: "Sneaky", parent_id: bid("svcCat") }))).status).toBe(404);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.serviceCategories))).toHaveLength(before.length);
    });
    it("PATCH changes only what is sent", async () => {
      const r = await call(patchCat, key, { id: ids.newCat! }, send("PATCH", { name: "Colour & Tone" }), q("service"));
      expect(r.status).toBe(200);
      const row = await withTenant(A(), (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, ids.newCat!) }));
      expect(row).toMatchObject({ name: "Colour & Tone", description: "All colour", prepNotes: "Come with dry hair", parentId: id("svcCat") });
    });
    it("PATCH can move a category to the top level (null) and refuses a cycle with 409", async () => {
      expect((await call(patchCat, key, { id: id("svcCat") }, send("PATCH", { parent_id: ids.newCat }), q("service"))).status).toBe(409);
      expect((await call(patchCat, key, { id: ids.newCat! }, send("PATCH", { parent_id: ids.newCat }), q("service"))).status).toBe(409);
      expect((await call(patchCat, key, { id: ids.newCat! }, send("PATCH", { parent_id: null }), q("service"))).status).toBe(200);
      expect((await withTenant(A(), (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, ids.newCat!) })))?.parentId).toBeNull();
    });
    it("renames a product category, and refuses fields it does not have", async () => {
      expect((await call(patchCat, key, { id: ids.newProdCat! }, send("PATCH", { name: "Styling aids" }), q("product"))).status).toBe(200);
      expect((await call(patchCat, key, { id: ids.newProdCat! }, send("PATCH", { description: "x" }), q("product"))).status).toBe(422);
    });
    it("answers 404 for another business's category on read, write, move and delete, leaving it untouched; ids from the body are checked too", async () => {
      const other = bid("svcCat");
      expect((await call(getCat, key, { id: other }, {}, q("service"))).status).toBe(404);
      expect((await call(patchCat, key, { id: other }, send("PATCH", { name: "Hacked" }), q("service"))).status).toBe(404);
      expect((await call(moveCat, key, { id: other }, send("POST", { direction: "down" }), q("service"))).status).toBe(404);
      expect((await call(delCat, key, { id: other }, send("DELETE"), q("service"))).status).toBe(404);
      expect((await call(patchCat, key, { id: ids.newCat! }, send("PATCH", { parent_id: other }), q("service"))).status).toBe(404);
      const still = await withTenant(B(), (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, other) }));
      expect(still?.name).toBe(`Hair ${B()}`);
      // A product category id looked up as a service category is not found either.
      expect((await call(getCat, key, { id: bid("prodCat") }, {}, q("product"))).status).toBe(404);
    });
    it("moves a category one step among its siblings", async () => {
      const r = await call(moveCat, key, { id: id("svcCat") }, send("POST", { direction: "down" }), q("service"));
      expect(r.status).toBe(200);
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.serviceCategories).where(eq(schema.serviceCategories.businessId, A())));
      const bySort = (name: string) => rows.find((x) => x.name === name)!.sortOrder;
      expect(bySort(`Hair ${A()}`)).toBeGreaterThan(bySort(`Nails ${A()}`));
      expect((await call(moveCat, key, { id: id("svcCat") }, send("POST", { direction: "sideways" }), q("service"))).status).toBe(422);
    });
    it("DELETE removes the category; its services become uncategorised and sub-categories move up", async () => {
      const [child] = await withTenant(A(), (tx) => tx.insert(schema.serviceCategories).values({ businessId: A(), name: "Child", parentId: id("svcCat2") }).returning());
      const [svc] = await withTenant(A(), (tx) => tx.insert(schema.services).values({ businessId: A(), name: "Gel", durationMin: 30, priceCents: 1, categoryId: id("svcCat2") }).returning());
      expect((await call(delCat, key, { id: id("svcCat2") }, send("DELETE"), q("service"))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, id("svcCat2")) }))).toBeUndefined();
      expect((await withTenant(A(), (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, svc!.id) })))?.categoryId).toBeNull();
      expect((await withTenant(A(), (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, child!.id) })))?.parentId).toBeNull();
    });
    it("needs catalog:write for writes (403) and catalog:read for reads", async () => {
      expect((await call(postCat, readKey, noParams, send("POST", { kind: "service", name: "Z" }))).status).toBe(403);
      expect((await call(patchCat, readKey, { id: id("svcCat") }, send("PATCH", { name: "Z" }), q("service"))).status).toBe(403);
      expect((await call(delCat, readKey, { id: id("svcCat") }, send("DELETE"), q("service"))).status).toBe(403);
      expect((await call(moveCat, readKey, { id: id("svcCat") }, send("POST", { direction: "up" }), q("service"))).status).toBe(403);
      expect((await call(getCat, otherScope, { id: id("svcCat") }, {}, q("service"))).status).toBe(403);
      expect((await call(getCat, readKey, { id: id("svcCat") }, {}, q("service"))).status).toBe(200);
    });
  });

  describe("services: order and who performs them", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("moves a service within its category and renumbers siblings", async () => {
      expect((await call(moveSvc, key, { id: id("s1") }, send("POST", { direction: "down" }))).status).toBe(200);
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.services).where(and(eq(schema.services.businessId, A()), eq(schema.services.categoryId, id("svcCat")))));
      expect(rows.find((x) => x.id === id("s1"))!.sortOrder).toBeGreaterThan(rows.find((x) => x.id === id("s2"))!.sortOrder);
      // Moving the last one further down is a harmless no-op.
      expect((await call(moveSvc, key, { id: id("s1") }, send("POST", { direction: "down" }))).status).toBe(200);
      expect((await call(moveSvc, key, { id: id("s1") }, send("POST", { direction: "x" }))).status).toBe(422);
    });
    it("404s another business's service and leaves its order alone", async () => {
      expect((await call(moveSvc, key, { id: bid("s1") }, send("POST", { direction: "down" }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, bid("s1")) })))?.sortOrder).toBe(0);
    });
    it("PUT sets who performs it with their own price and length, GET reads it back", async () => {
      const r = await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st"), price_cents: 9000, duration_min: 60 }, { staff_id: id("st2") }] }));
      expect(r.status).toBe(200);
      const got = (await (await call(getSvcStaff, key, { id: id("s1") })).json()).data;
      expect(got).toHaveLength(2);
      expect(got.find((x: { staff_id: string }) => x.staff_id === id("st"))).toMatchObject({ price_cents: 9000, duration_min: 60, price_override_cents: 9000, duration_override_min: 60 });
      expect(got.find((x: { staff_id: string }) => x.staff_id === id("st2"))).toMatchObject({ price_cents: 5000, duration_min: 30, price_override_cents: null });
    });
    it("a value equal to the service's own is stored as 'use the service's', omitted fields keep what is stored, null clears", async () => {
      await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st"), price_cents: 5000 }, { staff_id: id("st2"), price_cents: 6500 }] }));
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.serviceId, id("s1"))));
      expect(rows.find((x) => x.staffId === id("st"))).toMatchObject({ priceCentsOverride: null, durationMinOverride: 60 }); // price = base -> null; duration kept
      await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st") }, { staff_id: id("st2"), duration_min: null }] }));
      const again = await withTenant(A(), (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.serviceId, id("s1"))));
      expect(again.find((x) => x.staffId === id("st"))).toMatchObject({ durationMinOverride: 60 });
      expect(again.find((x) => x.staffId === id("st2"))).toMatchObject({ priceCentsOverride: 6500, durationMinOverride: null });
    });
    it("a person left out of the list stops performing it", async () => {
      await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st") }] }));
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.serviceId, id("s1"))));
      expect(rows.map((x) => x.staffId)).toEqual([id("st")]);
    });
    it("rejects another business's staff or service (404, nothing changes), duplicates and bad numbers (422)", async () => {
      const before = await withTenant(A(), (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.serviceId, id("s1"))));
      expect((await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: bid("st") }] }))).status).toBe(404);
      expect((await call(putSvcStaff, key, { id: bid("s1") }, send("PUT", { staff: [{ staff_id: id("st") }] }))).status).toBe(404);
      expect((await call(getSvcStaff, key, { id: bid("s1") })).status).toBe(404);
      expect((await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st") }, { staff_id: id("st") }] }))).status).toBe(422);
      expect((await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st"), duration_min: 2 }] }))).status).toBe(422);
      expect((await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st"), price_cents: -1 }] }))).status).toBe(422);
      expect((await call(putSvcStaff, key, { id: id("s1") }, send("PUT", { staff: [{ staff_id: id("st"), colour: "red" }] }))).status).toBe(422);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.serviceId, id("s1"))))).toHaveLength(before.length);
    });
    it("needs the right scopes", async () => {
      expect((await call(putSvcStaff, readKey, { id: id("s1") }, send("PUT", { staff: [] }))).status).toBe(403);
      expect((await call(moveSvc, readKey, { id: id("s1") }, send("POST", { direction: "up" }))).status).toBe(403);
      expect((await call(getSvcStaff, otherScope, { id: id("s1") })).status).toBe(403);
      expect((await call(getSvcStaff, readKey, { id: id("s1") })).status).toBe(200);
    });
  });

  describe("packages", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("creates (with defaults), reads and lists", async () => {
      const r = await call(postPkg, key, noParams, send("POST", { name: "10 colours", sessions: 10, price_cents: 90000, service_id: id("s2"), valid_days: 365 }));
      expect(r.status).toBe(201);
      const p = (await r.json()).data;
      expect(p).toMatchObject({ name: "10 colours", sessions: 10, price_cents: 90000, service_id: id("s2"), valid_days: 365, valid_location_ids: [], active: true });
      ids.newPkg = p.id;
      expect((await (await call(getPkg, key, { id: p.id })).json()).data.id).toBe(p.id);
      const list = (await (await call(listPkgs, key)).json()).data.map((x: { id: string }) => x.id);
      expect(list).toContain(p.id);
      expect(list).not.toContain(bid("pkg"));
    });
    it("PATCH leaves omitted fields alone and hides/shows with active", async () => {
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { price_cents: 18000 }))).status).toBe(200);
      let row = await withTenant(A(), (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id("pkg")) }));
      expect(row).toMatchObject({ name: "5 cuts", sessions: 5, priceCents: 18000, serviceId: id("s1"), description: "keep me", active: true });
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { active: false }))).status).toBe(200);
      expect((await (await call(listPkgs, key)).json()).data.map((x: { id: string }) => x.id)).not.toContain(id("pkg"));
      expect((await (await call(listPkgs, key, noParams, {}, "http://x/api/v1/t?include_inactive=1")).json()).data.map((x: { id: string }) => x.id)).toContain(id("pkg"));
      await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { active: true }));
      row = await withTenant(A(), (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id("pkg")) }));
      expect(row).toMatchObject({ active: true, description: "keep me" });
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { valid_days: null, description: null }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id("pkg")) }))).toMatchObject({ validDays: null, description: null });
    });
    it("valid_location_ids: every location (or none) means everywhere", async () => {
      const one = await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { valid_location_ids: [id("loc")] }));
      expect((await one.json()).data.valid_location_ids).toEqual([id("loc")]);
      const all = await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { valid_location_ids: [id("loc"), id("loc2")] }));
      expect((await all.json()).data.valid_location_ids).toEqual([]);
    });
    it("rejects another business's service or location in the body, and another business's package id (404, untouched)", async () => {
      expect((await call(postPkg, key, noParams, send("POST", { name: "X", sessions: 1, price_cents: 1, service_id: bid("s1") }))).status).toBe(404);
      expect((await call(postPkg, key, noParams, send("POST", { name: "X", sessions: 1, price_cents: 1, valid_location_ids: [bid("loc")] }))).status).toBe(404);
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { service_id: bid("s1") }))).status).toBe(404);
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { valid_location_ids: [bid("loc")] }))).status).toBe(404);
      expect((await call(getPkg, key, { id: bid("pkg") })).status).toBe(404);
      expect((await call(patchPkg, key, { id: bid("pkg") }, send("PATCH", { name: "Hacked", active: false }))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, bid("pkg")) }))).toMatchObject({ name: "5 cuts", active: true });
      expect(await withTenant(A(), (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id("pkg")) }))).toMatchObject({ serviceId: id("s1") });
    });
    it("validates (422) and checks scopes (403)", async () => {
      for (const bad of [{ name: "X", sessions: 0, price_cents: 1 }, { name: "X", sessions: 1 }, { name: "", sessions: 1, price_cents: 1 }, { name: "X", sessions: 1, price_cents: 1, bogus: 1 }, { name: "X", sessions: 101, price_cents: 1 }]) {
        expect((await call(postPkg, key, noParams, send("POST", bad))).status).toBe(422);
      }
      expect((await call(patchPkg, key, { id: id("pkg") }, send("PATCH", { valid_days: 0 }))).status).toBe(422);
      expect((await call(postPkg, readKey, noParams, send("POST", { name: "X", sessions: 1, price_cents: 1 }))).status).toBe(403);
      expect((await call(patchPkg, readKey, { id: id("pkg") }, send("PATCH", { name: "X" }))).status).toBe(403);
      expect((await call(getPkg, otherScope, { id: id("pkg") })).status).toBe(403);
    });
  });

  describe("membership plans", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("creates with defaults and lists", async () => {
      const r = await call(postPlan, key, noParams, send("POST", { name: "Silver", price_cents: 4900 }));
      expect(r.status).toBe(201);
      const p = (await r.json()).data;
      expect(p).toMatchObject({ name: "Silver", price_cents: 4900, interval: "month", interval_count: 1, included_sessions: 0, rollover_cap: 0, cycle_count: null, discount_bps: 0, active: true });
      ids.newPlan = p.id;
      const list = (await (await call(listPlans, key)).json()).data.map((x: { id: string }) => x.id);
      expect(list).toContain(p.id);
      expect(list).not.toContain(bid("plan"));
      expect((await (await call(getPlan, key, { id: p.id })).json()).data.name).toBe("Silver");
    });
    it("applies the app's rules: sessions need a service, and the cadence must be billable", async () => {
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, included_sessions: 2 }))).status).toBe(422);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, interval: "year", interval_count: 2 }))).status).toBe(422);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, interval: "month", interval_count: 60 }))).status).toBe(422);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, interval: "day" }))).status).toBe(422);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, interval: "week", interval_count: 2, included_sessions: 2, included_service_id: id("s1"), discount_bps: 1000, cycle_count: 6 }))).status).toBe(201);
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { included_sessions: 3 }))).status).toBe(422);
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { interval: "year", interval_count: 3 }))).status).toBe(422);
    });
    it("PATCH leaves omitted fields alone, and a new price or cadence clears the Stripe price", async () => {
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { name: "Gold plus" }))).status).toBe(200);
      let row = await withTenant(A(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id("plan")) }));
      expect(row).toMatchObject({ name: "Gold plus", priceCents: 9900, description: "keep me", stripePriceId: "price_x", interval: "month" });
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { price_cents: 9900 }))).status).toBe(200); // same price: no reset
      expect((await withTenant(A(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id("plan")) })))?.stripePriceId).toBe("price_x");
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { price_cents: 10900 }))).status).toBe(200);
      row = await withTenant(A(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id("plan")) }));
      expect(row).toMatchObject({ priceCents: 10900, stripePriceId: null, description: "keep me" });
      await withTenant(A(), (tx) => tx.update(schema.membershipPlans).set({ stripePriceId: "price_y" }).where(eq(schema.membershipPlans.id, id("plan"))));
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { interval: "week", interval_count: 2 }))).status).toBe(200);
      expect((await withTenant(A(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id("plan")) })))?.stripePriceId).toBeNull();
    });
    it("hides and shows with active", async () => {
      await call(patchPlan, key, { id: id("plan") }, send("PATCH", { active: false }));
      expect((await (await call(listPlans, key)).json()).data.map((x: { id: string }) => x.id)).not.toContain(id("plan"));
      expect((await (await call(listPlans, key, noParams, {}, "http://x/api/v1/t?include_inactive=1")).json()).data.map((x: { id: string }) => x.id)).toContain(id("plan"));
      await call(patchPlan, key, { id: id("plan") }, send("PATCH", { active: true }));
      expect((await withTenant(A(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, id("plan")) })))?.active).toBe(true);
    });
    it("rejects another business's ids (404, untouched), bad bodies (422) and missing scopes (403)", async () => {
      expect((await call(getPlan, key, { id: bid("plan") })).status).toBe(404);
      expect((await call(patchPlan, key, { id: bid("plan") }, send("PATCH", { price_cents: 1 }))).status).toBe(404);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, included_service_id: bid("s1"), included_sessions: 1 }))).status).toBe(404);
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { included_service_id: bid("s1") }))).status).toBe(404);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, valid_location_ids: [bid("loc")] }))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, bid("plan")) }))).toMatchObject({ priceCents: 9900, stripePriceId: "price_x" });
      expect((await call(postPlan, key, noParams, send("POST", { price_cents: 1 }))).status).toBe(422);
      expect((await call(postPlan, key, noParams, send("POST", { name: "X", price_cents: 1, stripe_price_id: "p" }))).status).toBe(422);
      expect((await call(patchPlan, key, { id: id("plan") }, send("PATCH", { discount_bps: 20000 }))).status).toBe(422);
      expect((await call(postPlan, readKey, noParams, send("POST", { name: "X", price_cents: 1 }))).status).toBe(403);
      expect((await call(patchPlan, readKey, { id: id("plan") }, send("PATCH", { name: "X" }))).status).toBe(403);
      const text = JSON.stringify(await (await call(getPlan, key, { id: id("plan") })).json());
      expect(text).not.toContain("price_x");
      expect(text).not.toContain("price_y");
      expect(text).not.toContain("stripe");
    });
  });

  describe("products: supplier, reorder level and the rules that keep options in step", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("creates with a supplier and reorder level, refusing foreign suppliers and a level under the low-stock level", async () => {
      const r = await call(postProduct, key, noParams, send("POST", { name: "Mask", price_cents: 2500, supplier_id: id("sup"), reorder_up_to: 12, low_stock_threshold: 4, track_stock: true }));
      expect(r.status).toBe(201);
      const p = (await r.json()).data;
      const row = await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, p.id) }));
      expect(row).toMatchObject({ supplierId: id("sup"), reorderUpTo: 12, lowStockThreshold: 4 });
      ids.mask = p.id;
      expect((await call(postProduct, key, noParams, send("POST", { name: "X", price_cents: 1, supplier_id: bid("sup") }))).status).toBe(404);
      expect((await call(postProduct, key, noParams, send("POST", { name: "X", price_cents: 1, category_id: bid("prodCat") }))).status).toBe(404);
      expect((await call(postProduct, key, noParams, send("POST", { name: "X", price_cents: 1, low_stock_threshold: 5, reorder_up_to: 2 }))).status).toBe(422);
      expect((await call(postProduct, key, noParams, send("POST", { name: "X", price_cents: 1, bogus: true }))).status).toBe(422);
    });
    it("PATCH sets and clears supplier and reorder level, leaves the rest alone, and does nothing on an empty body", async () => {
      expect((await call(patchProduct, key, { id: ids.mask! }, send("PATCH", { reorder_up_to: null, supplier_id: null }))).status).toBe(200);
      let row = await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, ids.mask!) }));
      expect(row).toMatchObject({ supplierId: null, reorderUpTo: null, name: "Mask", priceCents: 2500, lowStockThreshold: 4, trackStock: true });
      expect((await call(patchProduct, key, { id: ids.mask! }, send("PATCH", {}))).status).toBe(200);
      expect((await call(patchProduct, key, { id: ids.mask! }, send("PATCH", { reorder_up_to: 1 }))).status).toBe(422); // below its low-stock level of 4
      row = await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, ids.mask!) }));
      expect(row?.reorderUpTo).toBeNull();
      expect((await call(patchProduct, key, { id: ids.mask! }, send("PATCH", { supplier_id: bid("sup") }))).status).toBe(404);
      expect((await call(patchProduct, key, { id: bid("prod") }, send("PATCH", { name: "Hacked" }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, bid("prod")) })))?.name).toBe("Shampoo");
    });
    it("a back-bar product is never sold online and always counted", async () => {
      const r = await call(patchProduct, key, { id: ids.mask! }, send("PATCH", { kind: "backbar", sell_online: true, track_stock: false }));
      expect(r.status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, ids.mask!) }))).toMatchObject({ kind: "backbar", sellOnline: false, trackStock: true });
    });
    it("needs catalog:write", async () => {
      expect((await call(postProduct, readKey, noParams, send("POST", { name: "X", price_cents: 1 }))).status).toBe(403);
      expect((await call(patchProduct, readKey, { id: ids.mask! }, send("PATCH", { name: "X" }))).status).toBe(403);
    });
  });

  describe("product groups (options)", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("creates a group with one product per option (cleaned and de-duplicated labels)", async () => {
      const r = await call(postGroup, key, noParams, send("POST", { name: "Colour Gel", options: ["7N", " 8N ", "7n", "9  N"], price_cents: 2200, cost_cents: 900, category_id: id("prodCat"), supplier_id: id("sup"), taxable: true }));
      expect(r.status).toBe(201);
      const g = (await r.json()).data;
      expect(g.options.map((o: { variant_label: string }) => o.variant_label).sort()).toEqual(["7N", "8N", "9 N"]);
      expect(g.options.every((o: { price_cents: number }) => o.price_cents === 2200)).toBe(true);
      expect(JSON.stringify(g)).not.toContain("cost");
      expect(JSON.stringify(g)).not.toContain("supplier");
      ids.group = g.id;
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.products).where(eq(schema.products.groupId, g.id)));
      expect(rows).toHaveLength(3);
      expect(rows.every((p) => p.name === "Colour Gel" && p.costCents === 900 && p.supplierId === id("sup") && p.categoryId === id("prodCat"))).toBe(true);
    });
    it("lists and reads groups, only this business's", async () => {
      const list = (await (await call(listGroups, key)).json()).data;
      expect(list.map((g: { id: string }) => g.id)).toContain(ids.group);
      expect((await (await call(getGroup, key, { id: ids.group! })).json()).data.options).toHaveLength(3);
    });
    it("validates a create (422): no options, retail without a price, bad reorder level, unknown field; and checks ids from the body (404)", async () => {
      for (const bad of [{ name: "X", options: [], price_cents: 1 }, { name: "X", options: ["a"] }, { name: "X", options: ["a"], price_cents: 1, low_stock_threshold: 5, reorder_up_to: 1 }, { name: "X", options: ["a"], price_cents: 1, color: "x" }, { options: ["a"], price_cents: 1 }, { name: "X", options: ["  "], price_cents: 1 }]) {
        expect((await call(postGroup, key, noParams, send("POST", bad))).status).toBe(422);
      }
      expect((await call(postGroup, key, noParams, send("POST", { name: "X", options: ["a"], price_cents: 1, category_id: bid("prodCat") }))).status).toBe(404);
      expect((await call(postGroup, key, noParams, send("POST", { name: "X", options: ["a"], price_cents: 1, supplier_id: bid("sup") }))).status).toBe(404);
      expect((await call(postGroup, readKey, noParams, send("POST", { name: "X", options: ["a"], price_cents: 1 }))).status).toBe(403);
    });
    it("a back-bar group needs no price and its options are counted", async () => {
      const r = await call(postGroup, key, noParams, send("POST", { name: "Developer", kind: "backbar", options: ["20 vol"] }));
      expect(r.status).toBe(201);
      const g = (await r.json()).data;
      expect(g.options[0]).toMatchObject({ price_cents: 0, track_stock: true });
    });
    it("PATCH changes what the options share and every option follows; omitted fields stay", async () => {
      const r = await call(patchGroup, key, { id: ids.group! }, send("PATCH", { name: "Colour Gel Pro", description: "Great" }));
      expect(r.status).toBe(200);
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.products).where(eq(schema.products.groupId, ids.group!)));
      expect(rows.every((p) => p.name === "Colour Gel Pro" && p.description === "Great" && p.categoryId === id("prodCat") && p.taxable)).toBe(true);
      const g = await withTenant(A(), (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, ids.group!) }));
      expect(g).toMatchObject({ name: "Colour Gel Pro", categoryId: id("prodCat"), supplierId: id("sup"), kind: "retail" });
      expect((await call(patchGroup, key, { id: ids.group! }, send("PATCH", { sell_online: true }))).status).toBe(200);
      expect((await withTenant(A(), (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, ids.group!) })))?.sellOnline).toBe(true);
      // Becoming back-bar (a separate group: it zeroes the options' prices and counts them) never sells online.
      const tmp = (await (await call(postGroup, key, noParams, send("POST", { name: "Temp", options: ["a"], price_cents: 500, sell_online: true }))).json()).data;
      expect((await call(patchGroup, key, { id: tmp.id }, send("PATCH", { kind: "backbar" }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, tmp.id) }))).toMatchObject({ kind: "backbar", sellOnline: false });
      expect((await withTenant(A(), (tx) => tx.select().from(schema.products).where(eq(schema.products.groupId, tmp.id))))[0]).toMatchObject({ priceCents: 0, trackStock: true, sellOnline: false });
      expect((await call(patchGroup, key, { id: tmp.id }, send("PATCH", { sell_online: true }))).status).toBe(200);
      expect((await withTenant(A(), (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, tmp.id) })))?.sellOnline).toBe(false);
    });
    it("active hides and shows the group with all its options", async () => {
      await call(patchGroup, key, { id: ids.group! }, send("PATCH", { active: false }));
      expect((await withTenant(A(), (tx) => tx.select().from(schema.products).where(eq(schema.products.groupId, ids.group!)))).every((p) => !p.active)).toBe(true);
      expect((await (await call(listGroups, key)).json()).data.map((g: { id: string }) => g.id)).not.toContain(ids.group);
      await call(patchGroup, key, { id: ids.group! }, send("PATCH", { active: true }));
      expect((await withTenant(A(), (tx) => tx.select().from(schema.products).where(eq(schema.products.groupId, ids.group!)))).every((p) => p.active)).toBe(true);
    });
    it("adds options (skipping ones it has) and refuses when nothing is new", async () => {
      const r = await call(addOptions, key, { id: ids.group! }, send("POST", { options: ["7N", "10N", "11N"] }));
      expect(r.status).toBe(201);
      const d = (await r.json()).data;
      expect(d).toMatchObject({ added: 2, skipped: ["7N"] });
      const added = await withTenant(A(), (tx) => tx.select().from(schema.products).where(and(eq(schema.products.groupId, ids.group!), eq(schema.products.variantLabel, "10N"))));
      expect(added[0]).toMatchObject({ priceCents: 2200, costCents: 900 }); // taken from the first option
      expect((await call(addOptions, key, { id: ids.group! }, send("POST", { options: ["7N"] }))).status).toBe(409);
      expect((await call(addOptions, key, { id: ids.group! }, send("POST", { options: [] }))).status).toBe(422);
      expect((await call(addOptions, key, { id: ids.group! }, send("POST", { options: ["13N"], price_cents: 3000 }))).status).toBe(201);
      expect((await withTenant(A(), (tx) => tx.select().from(schema.products).where(and(eq(schema.products.groupId, ids.group!), eq(schema.products.variantLabel, "13N")))))[0]?.priceCents).toBe(3000);
    });
    it("converts a product into a group once, and refuses a second time (409)", async () => {
      const [p] = await withTenant(A(), (tx) => tx.insert(schema.products).values({ businessId: A(), name: "Serum", priceCents: 4000 }).returning());
      ids.serum = p!.id;
      const r = await call(convert, key, { id: p!.id }, send("POST", { label: "30 ml" }));
      expect(r.status).toBe(201);
      const g = (await r.json()).data;
      expect(g.options.map((o: { variant_label: string }) => o.variant_label)).toEqual(["30 ml"]);
      ids.serumGroup = g.id;
      expect((await call(convert, key, { id: p!.id }, send("POST", { label: "50 ml" }))).status).toBe(409);
      expect((await call(convert, key, { id: p!.id }, send("POST", { label: "" }))).status).toBe(422);
    });
    it("an option's shared fields are changed on the group (409 on the option); its own fields can change", async () => {
      expect((await call(patchProduct, key, { id: ids.serum! }, send("PATCH", { name: "Other" }))).status).toBe(409);
      expect((await call(patchProduct, key, { id: ids.serum! }, send("PATCH", { supplier_id: id("sup") }))).status).toBe(409);
      expect((await call(patchProduct, key, { id: ids.serum! }, send("PATCH", { price_cents: 4500, variant_label: "30ml bottle" }))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, ids.serum!) }))).toMatchObject({ name: "Serum", priceCents: 4500, variantLabel: "30ml bottle" });
      // A second option cannot take the same label; a standalone product has no label to set.
      await call(addOptions, key, { id: ids.serumGroup! }, send("POST", { options: ["50 ml"] }));
      const second = (await withTenant(A(), (tx) => tx.select().from(schema.products).where(and(eq(schema.products.groupId, ids.serumGroup!), eq(schema.products.variantLabel, "50 ml")))))[0]!;
      expect((await call(patchProduct, key, { id: second.id }, send("PATCH", { variant_label: "30ML BOTTLE" }))).status).toBe(409);
      expect((await call(patchProduct, key, { id: id("prod") }, send("PATCH", { variant_label: "x" }))).status).toBe(409);
    });
    it("answers 404 for another business's group and product ids, leaving them untouched", async () => {
      const [og] = await withTenant(B(), (tx) => tx.insert(schema.productGroups).values({ businessId: B(), name: "Theirs" }).returning());
      expect((await call(getGroup, key, { id: og!.id })).status).toBe(404);
      expect((await call(patchGroup, key, { id: og!.id }, send("PATCH", { name: "Hacked", active: false }))).status).toBe(404);
      expect((await call(addOptions, key, { id: og!.id }, send("POST", { options: ["x"] }))).status).toBe(404);
      expect((await call(convert, key, { id: bid("prod") }, send("POST", { label: "x" }))).status).toBe(404);
      expect((await call(patchGroup, key, { id: ids.group! }, send("PATCH", { category_id: bid("prodCat") }))).status).toBe(404);
      expect((await call(patchGroup, key, { id: ids.group! }, send("PATCH", { supplier_id: bid("sup") }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.productGroups.findFirst({ where: eq(schema.productGroups.id, og!.id) })))).toMatchObject({ name: "Theirs", active: true });
      expect((await withTenant(B(), (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, bid("prod")) })))?.groupId).toBeNull();
    });
    it("validates PATCH bodies (422) and checks scopes (403)", async () => {
      expect((await call(patchGroup, key, { id: ids.group! }, send("PATCH", { name: "" }))).status).toBe(422);
      expect((await call(patchGroup, key, { id: ids.group! }, send("PATCH", { options: ["a"] }))).status).toBe(422);
      expect((await call(patchGroup, readKey, { id: ids.group! }, send("PATCH", { name: "x" }))).status).toBe(403);
      expect((await call(addOptions, readKey, { id: ids.group! }, send("POST", { options: ["x"] }))).status).toBe(403);
      expect((await call(convert, readKey, { id: ids.serum! }, send("POST", { label: "x" }))).status).toBe(403);
      expect((await call(getGroup, otherScope, { id: ids.group! })).status).toBe(403);
      expect((await call(getGroup, readKey, { id: ids.group! })).status).toBe(200);
    });
  });

  describe("extra barcodes", () => {
    beforeAll(async () => {
      key = await mkKey(kit.A, ["catalog:write"]);
    });
    it("adds, lists and removes an extra barcode", async () => {
      const r = await call(postCode, key, { id: id("prod") }, send("POST", { code: "CASE-12", units_per_scan: 12 }));
      expect(r.status).toBe(201);
      const c = (await r.json()).data;
      expect(c).toMatchObject({ code: "CASE-12", units_per_scan: 12, product_id: id("prod") });
      ids.code = c.id;
      expect((await (await call(listCodes, key, { id: id("prod") })).json()).data.map((x: { code: string }) => x.code)).toEqual(["CASE-12"]);
      expect((await call(delCode, key, { id: id("prod"), barcodeId: c.id }, send("DELETE"))).status).toBe(200);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.productBarcodes).where(eq(schema.productBarcodes.productId, id("prod"))))).toHaveLength(0);
    });
    it("a code can belong to one product only (409), including the product's own barcode and SKU", async () => {
      await call(postCode, key, { id: id("prod") }, send("POST", { code: "DUP-1" }));
      expect((await call(postCode, key, { id: ids.mask! }, send("POST", { code: "DUP-1" }))).status).toBe(409);
      expect((await call(postCode, key, { id: ids.mask! }, send("POST", { code: `BAR-${A()}` }))).status).toBe(409);
      expect((await call(postCode, key, { id: ids.mask! }, send("POST", { code: `SKU-${A()}` }))).status).toBe(409);
    });
    it("validates (422)", async () => {
      expect((await call(postCode, key, { id: id("prod") }, send("POST", { code: "" }))).status).toBe(422);
      expect((await call(postCode, key, { id: id("prod") }, send("POST", { code: "X", units_per_scan: 0 }))).status).toBe(422);
      expect((await call(postCode, key, { id: id("prod") }, send("POST", { code: "X", extra: 1 }))).status).toBe(422);
    });
    it("answers 404 for another business's product or barcode and leaves them", async () => {
      const [theirs] = await withTenant(B(), (tx) => tx.insert(schema.productBarcodes).values({ businessId: B(), productId: bid("prod"), code: "THEIRS", unitsPerScan: 1 }).returning());
      expect((await call(postCode, key, { id: bid("prod") }, send("POST", { code: "MINE-1" }))).status).toBe(404);
      expect((await call(listCodes, key, { id: bid("prod") })).status).toBe(404);
      expect((await call(delCode, key, { id: bid("prod"), barcodeId: theirs!.id }, send("DELETE"))).status).toBe(404);
      // Naming their barcode id under my own product is not found either.
      expect((await call(delCode, key, { id: id("prod"), barcodeId: theirs!.id }, send("DELETE"))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.select().from(schema.productBarcodes).where(eq(schema.productBarcodes.id, theirs!.id)))).toHaveLength(1);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.productBarcodes).where(eq(schema.productBarcodes.code, "MINE-1")))).toHaveLength(0);
    });
    it("needs catalog:write to change and catalog:read to list", async () => {
      expect((await call(postCode, readKey, { id: id("prod") }, send("POST", { code: "Z" }))).status).toBe(403);
      expect((await call(delCode, readKey, { id: id("prod"), barcodeId: "x" }, send("DELETE"))).status).toBe(403);
      expect((await call(listCodes, readKey, { id: id("prod") })).status).toBe(200);
      expect((await call(listCodes, otherScope, { id: id("prod") })).status).toBe(403);
    });
  });

  it("every write above left an audit row", async () => {
    const rows = await withTenant(A(), (tx) => tx.select({ a: schema.auditLog.action }).from(schema.auditLog));
    const actions = new Set(rows.map((r) => r.a));
    for (const a of ["api.category.create", "api.category.update", "api.category.delete", "api.category.move", "api.service.move", "api.service.staff", "api.package.create", "api.package.update", "api.membership_plan.create", "api.membership_plan.update", "api.product_group.create", "api.product_group.update", "api.product_group.add_options", "api.product.convert_to_group", "api.product.barcode_add", "api.product.barcode_remove", "api.product.create", "api.product.update"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});
