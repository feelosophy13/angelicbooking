/**
 * Integration test for the marketing API (campaigns, promo codes, automations): own-business only, foreign ids rejected, PATCH keeps
 * what it does not mention, a campaign sends once. Needs Postgres at DATABASE_URL; skipped otherwise. Nothing is delivered: `after`
 * is stubbed, so sending only queues notification rows.
 */
import "../../../../../packages/db/src/env"; // first: the db client reads DATABASE_URL (the RLS-bound app role) when it is created
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getSql, schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

import { GET as listCampaigns, POST as postCampaign } from "@/app/api/v1/campaigns/route";
import { GET as getCampaign, PATCH as patchCampaign, DELETE as deleteCampaign } from "@/app/api/v1/campaigns/[id]/route";
import { GET as getAudience } from "@/app/api/v1/campaigns/[id]/audience/route";
import { POST as previewAudience } from "@/app/api/v1/campaigns/audience-preview/route";
import { POST as sendCampaign } from "@/app/api/v1/campaigns/[id]/send/route";
import { GET as listPromos, POST as postPromo } from "@/app/api/v1/promo-codes/route";
import { GET as getPromo, PATCH as patchPromo } from "@/app/api/v1/promo-codes/[id]/route";
import { GET as listAutomations, POST as postAutomation } from "@/app/api/v1/automations/route";
import { GET as getAutomation, PATCH as patchAutomation, DELETE as deleteAutomation } from "@/app/api/v1/automations/[id]/route";
import { POST as duplicateAutomation } from "@/app/api/v1/automations/[id]/duplicate/route";
import { GET as getRuns } from "@/app/api/v1/automations/[id]/runs/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let ro: string; // marketing:read only
let nope: string; // an unrelated scope
const seed: Record<string, string> = {};

const email = (n: string) => `${n}-${crypto.randomUUID().slice(0, 6)}@example.com`;

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit(["marketing:write"]);
  ro = await mkKey(kit.A, ["marketing:read"]);
  nope = await mkKey(kit.A, ["catalog:read"]);
  for (const b of [kit.A, kit.B]) {
    const [svc] = await withTenant(b, (tx) => tx.insert(schema.services).values({ businessId: b, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
    const [st] = await withTenant(b, (tx) => tx.insert(schema.staff).values({ businessId: b, displayName: "Stylist" }).returning());
    const [loc] = await withTenant(b, (tx) => tx.insert(schema.locations).values({ businessId: b, name: "Main" }).returning());
    const [cat] = await withTenant(b, (tx) => tx.insert(schema.serviceCategories).values({ businessId: b, name: "Hair" }).returning());
    seed[`svc${b}`] = svc!.id; seed[`staff${b}`] = st!.id; seed[`loc${b}`] = loc!.id; seed[`cat${b}`] = cat!.id;
  }
  // A has two reachable email clients (one tagged vip) and one who unsubscribed; B has one.
  await withTenant(kit.A, (tx) => tx.insert(schema.clients).values([
    { businessId: kit.A, firstName: "Ann", email: email("ann"), tags: ["vip"] },
    { businessId: kit.A, firstName: "Bea", email: email("bea") },
    { businessId: kit.A, firstName: "Cy", email: email("cy"), emailOptIn: false },
  ]));
  await withTenant(kit.B, (tx) => tx.insert(schema.clients).values({ businessId: kit.B, firstName: "Bob", email: email("bob") }));
  const [bc] = await withTenant(kit.B, (tx) => tx.insert(schema.campaigns).values({ businessId: kit.B, name: "B campaign", channel: "email", subject: "Hi", body: "Hello" }).returning());
  seed.bCampaign = bc!.id;
  const [bp] = await withTenant(kit.B, (tx) => tx.insert(schema.promoCodes).values({ businessId: kit.B, code: "BONLY", type: "percent", value: 10 }).returning());
  seed.bPromo = bp!.id;
  const [bw] = await withTenant(kit.B, (tx) => tx.insert(schema.workflows).values({ businessId: kit.B, name: "B flow", trigger: "client_created", steps: [{ id: "s1", type: "tag", tag: "x" }], enabled: true }).returning());
  seed.bFlow = bw!.id;
});

afterAll(async () => {
  if (!up) return;
  await kit.teardown();
  await getSql().end();
});

const j = (r: Response) => r.json();
const bCampaignNow = () => withTenant(kit.B, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, seed.bCampaign!) }));
const bFlowNow = () => withTenant(kit.B, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, seed.bFlow!) }));
const bNotifications = () => withTenant(kit.B, (tx) => tx.select().from(schema.notifications));

describe.skipIf(!up)("campaigns", () => {
  let id = "";
  it("creates a draft (nothing is sent) and defaults the rest", async () => {
    const r = await call(postCampaign, kit.key, {}, send("POST", { name: "Spring", channel: "email", subject: "Spring sale", body: "Come in, {first_name}" }));
    expect(r.status).toBe(201);
    const d = (await j(r)).data;
    id = d.id;
    expect(d).toMatchObject({ name: "Spring", status: "draft", recipient_count: 0, audience: { never_visited: false, tag: null } });
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.notifications))).toHaveLength(0);
  });
  it("validates: 422 for bad shapes, 409 for the app's rules", async () => {
    for (const bad of [{ channel: "email", body: "x" }, { name: "n", channel: "fax", body: "x" }, { name: "n", channel: "email", body: "x", extra: 1 }, { name: "n", channel: "email", body: "x", audience: { lapsed_days: 0 } }, { name: "", channel: "email", body: "x" }]) {
      expect((await call(postCampaign, kit.key, {}, send("POST", bad))).status).toBe(422);
    }
    const noSubject = await call(postCampaign, kit.key, {}, send("POST", { name: "n", channel: "email", body: "x" }));
    expect(noSubject.status).toBe(409);
    expect((await j(noSubject)).error.message).toBe("Add a subject line");
    expect((await call(postCampaign, kit.key, {}, send("POST", { name: "n", channel: "sms", body: "x".repeat(400) }))).status).toBe(409);
  });
  it("rejects another business's ids in the audience (404) and creates nothing", async () => {
    for (const audience of [{ service_id: seed[`svc${kit.B}`] }, { staff_id: seed[`staff${kit.B}`] }, { location_id: seed[`loc${kit.B}`] }]) {
      expect((await call(postCampaign, kit.key, {}, send("POST", { name: "x", channel: "email", subject: "s", body: "b", audience }))).status).toBe(404);
    }
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.campaigns));
    expect(rows).toHaveLength(1);
  });
  it("lists and reads only its own", async () => {
    const list = await j(await call(listCampaigns, ro));
    expect(list.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await call(getCampaign, ro, { id })).status).toBe(200);
    expect((await call(getCampaign, ro, { id: seed.bCampaign! })).status).toBe(404);
    expect((await call(getAudience, ro, { id: seed.bCampaign! })).status).toBe(404);
  });
  it("PATCH changes only what it names; an audience replaces the old one", async () => {
    const r = await call(patchCampaign, kit.key, { id }, send("PATCH", { name: "Spring 2" }));
    expect(r.status).toBe(200);
    const row = await withTenant(kit.A, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) }));
    expect(row).toMatchObject({ name: "Spring 2", subject: "Spring sale", body: "Come in, {first_name}", channel: "email" });
    await call(patchCampaign, kit.key, { id }, send("PATCH", { audience: { tag: "vip" } }));
    const again = await withTenant(kit.A, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) }));
    expect(again?.audience).toMatchObject({ tag: "vip", neverVisited: false });
    expect(again?.name).toBe("Spring 2");
  });
  it("PATCH: 422 on bad fields, 404 on foreign ids and other businesses' campaigns (which stay untouched)", async () => {
    expect((await call(patchCampaign, kit.key, { id }, send("PATCH", { name: "" }))).status).toBe(422);
    expect((await call(patchCampaign, kit.key, { id }, send("PATCH", { bogus: 1 }))).status).toBe(422);
    expect((await call(patchCampaign, kit.key, { id }, send("PATCH", { audience: { service_id: seed[`svc${kit.B}`] } }))).status).toBe(404);
    expect((await call(patchCampaign, kit.key, { id: seed.bCampaign! }, send("PATCH", { name: "Hacked" }))).status).toBe(404);
    expect((await bCampaignNow())?.name).toBe("B campaign");
    expect((await call(patchCampaign, kit.key, { id }, send("PATCH", { subject: null }))).status).toBe(409); // an email needs its subject
  });
  it("counts the audience for a saved or unsaved campaign", async () => {
    expect((await j(await call(getAudience, ro, { id }))).data.count).toBe(1); // vip only
    const all = await j(await call(previewAudience, ro, {}, send("POST", { channel: "email" })));
    expect(all.data.count).toBe(2); // Cy unsubscribed; B's Bob is not ours
    expect((await call(previewAudience, ro, {}, send("POST", { channel: "email", audience: { staff_id: seed[`staff${kit.B}`] } }))).status).toBe(404);
    expect((await call(previewAudience, ro, {}, send("POST", { channel: "pigeon" }))).status).toBe(422);
  });
  it("refuses to email a campaign until the business has a postal address (CAN-SPAM)", async () => {
    await call(patchCampaign, kit.key, { id }, send("PATCH", { audience: {} }));
    const r = await call(sendCampaign, kit.key, { id }, send("POST"));
    expect(r.status).not.toBe(200);
    expect((await j(r)).error.message).toMatch(/postal address/);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.campaignId, id)))).toHaveLength(0);
    // The main location's address is enough.
    await withTenant(kit.A, (tx) => tx.update(schema.locations).set({ addressLine1: "1 Main St", city: "Sterling", state: "VA", postalCode: "20164" }).where(eq(schema.locations.id, seed[`loc${kit.A}`]!)));
    await withTenant(kit.B, (tx) => tx.update(schema.locations).set({ addressLine1: "2 Oak Ave", city: "Fairfax", state: "VA", postalCode: "22030" }).where(eq(schema.locations.id, seed[`loc${kit.B}`]!)));
  });

  it("sends exactly once: queues one row per client, then refuses a resend and further edits", async () => {
    await call(patchCampaign, kit.key, { id }, send("PATCH", { audience: {} }));
    const [a, b] = await Promise.all([call(sendCampaign, kit.key, { id }, send("POST")), call(sendCampaign, kit.key, { id }, send("POST"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = await j(a.status === 200 ? a : b);
    expect(ok.data.queued).toBe(2);
    expect(ok.data.campaign).toMatchObject({ status: "sent", recipient_count: 2 });
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.campaignId, id)));
    expect(rows).toHaveLength(2);
    expect(rows.every((n) => n.template === "campaign" && n.status === "queued")).toBe(true);
    const again = await call(sendCampaign, kit.key, { id }, send("POST"));
    expect(again.status).toBe(409);
    expect((await j(again)).error.message).toBe("This campaign was already sent.");
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.campaignId, id)))).toHaveLength(2);
    expect((await call(patchCampaign, kit.key, { id }, send("PATCH", { name: "late" }))).status).toBe(409);
    expect((await j(await call(getCampaign, ro, { id }))).data.delivery).toEqual({ sent: 0, failed: 0, pending: 2 });
  });
  it("two simultaneous sends of one campaign queue it once even without the in-process guard (row lock)", async () => {
    const { sendCampaign: sendDirect } = await import("@/server/marketing");
    const { db } = await import("@angelic/db");
    const business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    const made = await j(await call(postCampaign, kit.key, {}, send("POST", { name: "race", channel: "email", subject: "Hi", body: "Hello {first_name}", audience: {} })));
    const cid = made.data.id as string;
    const results = await Promise.allSettled([sendDirect(business, cid, "api:test"), sendDirect(business, cid, "api:test")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.campaignId, cid)))).toHaveLength(2);
  });
  it("cannot send another business's campaign", async () => {
    expect((await call(sendCampaign, kit.key, { id: seed.bCampaign! }, send("POST"))).status).toBe(404);
    expect((await bCampaignNow())?.status).toBe("draft");
    expect(await bNotifications()).toHaveLength(0);
  });
  it("refuses to send when nobody matches", async () => {
    const c = await j(await call(postCampaign, kit.key, {}, send("POST", { name: "none", channel: "email", subject: "s", body: "b", audience: { tag: "nobody-has-this" } })));
    const r = await call(sendCampaign, kit.key, { id: c.data.id }, send("POST"));
    expect(r.status).toBe(409);
    expect((await j(r)).error.message).toBe("Nobody matches this audience on that channel.");
    expect((await withTenant(kit.A, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, c.data.id) })))?.status).toBe("draft");
  });
  it("deletes only its own", async () => {
    expect((await call(deleteCampaign, kit.key, { id: seed.bCampaign! }, send("DELETE"))).status).toBe(404);
    expect(await bCampaignNow()).toBeTruthy();
    expect((await call(deleteCampaign, kit.key, { id }, send("DELETE"))).status).toBe(200);
    expect(await withTenant(kit.A, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) }))).toBeUndefined();
  });
  it("needs the scope", async () => {
    expect((await call(listCampaigns, nope)).status).toBe(403);
    expect((await call(postCampaign, ro, {}, send("POST", { name: "n", channel: "email", subject: "s", body: "b" }))).status).toBe(403);
    expect((await call(patchCampaign, ro, { id }, send("PATCH", { name: "n" }))).status).toBe(403);
    expect((await call(deleteCampaign, ro, { id }, send("DELETE"))).status).toBe(403);
    expect((await call(sendCampaign, ro, { id }, send("POST"))).status).toBe(403);
    expect((await call(previewAudience, nope, {}, send("POST", { channel: "email" }))).status).toBe(403);
  });
});

describe.skipIf(!up)("promo codes", () => {
  let id = "";
  it("creates a code with the app's normalisation and rules", async () => {
    const r = await call(postPromo, kit.key, {}, send("POST", { code: "spring 10!", type: "percent", value: 10, starts_on: "2026-03-01", expires_on: "2026-03-31", max_uses: 5, min_subtotal_cents: 2000, service_ids: [seed[`svc${kit.A}`]] }));
    expect(r.status).toBe(201);
    const d = (await j(r)).data;
    id = d.id;
    expect(d).toMatchObject({ code: "SPRING10", type: "percent", value: 10, max_uses: 5, uses_count: 0, min_subtotal_cents: 2000, active: true, service_ids: [seed[`svc${kit.A}`]] });
    expect(d.starts_at).toBeTruthy();
    expect(new Date(d.expires_at) > new Date(d.starts_at)).toBe(true);
  });
  it("answers 409 for a duplicate (any case) but lets another business use the same code", async () => {
    const dup = await call(postPromo, kit.key, {}, send("POST", { code: "Spring10", type: "amount", value: 500 }));
    expect(dup.status).toBe(409);
    expect((await j(dup)).error.message).toBe("That code already exists");
    expect((await call(postPromo, kit.key, {}, send("POST", { code: "BONLY", type: "amount", value: 500 }))).status).toBe(201);
  });
  it("validates", async () => {
    const post = (o: object) => call(postPromo, kit.key, {}, send("POST", o));
    expect((await post({ code: "OK1", type: "percent", value: 101 })).status).toBe(422);
    expect((await post({ code: "OK2", type: "percent", value: 0 })).status).toBe(422);
    expect((await post({ code: "OK3", type: "amount", value: 0 })).status).toBe(422);
    expect((await post({ code: "!!", type: "amount", value: 100 })).status).toBe(422);
    expect((await post({ code: "OK4", type: "amount", value: 100, starts_on: "March 1" })).status).toBe(422);
    expect((await post({ code: "OK5", type: "amount", value: 100, expires_on: "2026-02-31" })).status).toBe(422);
    expect((await post({ code: "OK6", type: "amount", value: 100, max_uses: 0 })).status).toBe(422);
    expect((await post({ code: "OK7", type: "amount", value: 100, uses_count: 99 })).status).toBe(422);
    expect((await post({ type: "amount", value: 100 })).status).toBe(422);
  });
  it("rejects another business's service ids (404) and creates nothing", async () => {
    const r = await call(postPromo, kit.key, {}, send("POST", { code: "FOREIGN", type: "percent", value: 5, service_ids: [seed[`svc${kit.B}`]] }));
    expect(r.status).toBe(404);
    expect(await withTenant(kit.A, (tx) => tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.code, "FOREIGN") }))).toBeUndefined();
  });
  it("lists and reads only its own", async () => {
    const codes = (await j(await call(listPromos, ro))).data.map((p: { code: string }) => p.code).sort();
    expect(codes).toEqual(["BONLY", "SPRING10"]);
    expect((await j(await call(listPromos, ro, {}, {}, "http://x/api/v1/promo-codes?active=false"))).data).toHaveLength(0);
    expect((await call(getPromo, ro, { id })).status).toBe(200);
    expect((await call(getPromo, ro, { id: seed.bPromo! })).status).toBe(404);
  });
  it("PATCH only switches a code on or off and leaves everything else alone", async () => {
    const r = await call(patchPromo, kit.key, { id }, send("PATCH", { active: false }));
    expect(r.status).toBe(200);
    const row = await withTenant(kit.A, (tx) => tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.id, id) }));
    expect(row).toMatchObject({ active: false, code: "SPRING10", value: 10, maxUses: 5, minSubtotalCents: 2000 });
    expect((await call(patchPromo, kit.key, { id }, send("PATCH", {}))).status).toBe(422);
    expect((await call(patchPromo, kit.key, { id }, send("PATCH", { value: 99 }))).status).toBe(422);
    expect((await call(patchPromo, kit.key, { id: seed.bPromo! }, send("PATCH", { active: false }))).status).toBe(404);
    const b = await withTenant(kit.B, (tx) => tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.id, seed.bPromo!) }));
    expect(b?.active).toBe(true);
  });
  it("needs the scope", async () => {
    expect((await call(listPromos, nope)).status).toBe(403);
    expect((await call(postPromo, ro, {}, send("POST", { code: "ZZ", type: "percent", value: 5 }))).status).toBe(403);
    expect((await call(patchPromo, ro, { id }, send("PATCH", { active: true }))).status).toBe(403);
  });
});

describe.skipIf(!up)("automations", () => {
  let id = "";
  const steps = [{ type: "wait", mode: "delay", hours: 24 }, { type: "email", subject: "Hi", body: "Hello {first_name}", cta_label: "Book" }];
  it("lists the built-in automations first", async () => {
    const r = await j(await call(listAutomations, ro));
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data.some((w: { template_key: string | null }) => w.template_key)).toBe(true);
    expect(r.data.every((w: { id: string }) => w.id !== seed.bFlow)).toBe(true);
    seed.template = r.data.find((w: { template_key: string | null }) => w.template_key).id;
  });
  it("creates one, off by default, and gives steps ids", async () => {
    const r = await call(postAutomation, kit.key, {}, send("POST", { name: "Win back", trigger: "no_visit", filters: { days: 90, tags: ["vip"] }, steps }));
    expect(r.status).toBe(201);
    const d = (await j(r)).data;
    id = d.id;
    expect(d).toMatchObject({ name: "Win back", trigger: "no_visit", enabled: false, exit_on_booking: false, template_key: null, filters: { days: 90, tags: ["vip"], service_ids: [] } });
    expect(d.steps[0].id).toBeTruthy();
    expect(d.steps[1]).toMatchObject({ type: "email", cta_label: "Book" });
  });
  it("validates the way the app does (422)", async () => {
    const post = (o: object) => call(postAutomation, kit.key, {}, send("POST", { name: "x", trigger: "birthday", steps: [{ type: "sms", body: "Happy birthday" }], ...o }));
    expect((await post({ steps: [] })).status).toBe(422); // add at least one step
    expect((await post({ steps: [{ type: "sms", body: "  " }] })).status).toBe(422);
    expect((await post({ steps: [{ type: "review_request" }] })).status).toBe(422); // needs Visit completed
    expect((await post({ steps: [{ type: "wait", mode: "before_appointment", hours: 2 }, { type: "sms", body: "x" }] })).status).toBe(422); // needs an appointment trigger
    expect((await post({ trigger: "no_visit" })).status).toBe(422); // days required
    expect((await post({ trigger: "sometime" })).status).toBe(422);
    expect((await post({ steps: [{ type: "points", points: 50 }] })).status).toBe(422); // loyalty points are not in the API
    expect((await post({ steps: new Array(21).fill({ type: "tag", tag: "t" }) })).status).toBe(422);
    expect((await post({ name: "" })).status).toBe(422);
    expect((await post({ filters: { min_rating: 9 } })).status).toBe(422);
    expect((await post({ unknown: 1 })).status).toBe(422);
  });
  it("rejects another business's ids in filters (404) and creates nothing", async () => {
    const before = (await j(await call(listAutomations, ro))).data.length;
    for (const filters of [{ service_ids: [seed[`svc${kit.B}`]] }, { category_ids: [seed[`cat${kit.B}`]] }, { location_ids: [seed[`loc${kit.B}`]] }, { staff_ids: [seed[`staff${kit.B}`]] }]) {
      expect((await call(postAutomation, kit.key, {}, send("POST", { name: "x", trigger: "birthday", steps: [{ type: "sms", body: "hi" }], filters }))).status).toBe(404);
    }
    expect((await j(await call(listAutomations, ro))).data.length).toBe(before);
  });
  it("reads only its own", async () => {
    expect((await call(getAutomation, ro, { id })).status).toBe(200);
    expect((await call(getAutomation, ro, { id: seed.bFlow! })).status).toBe(404);
    expect((await call(getRuns, ro, { id: seed.bFlow! })).status).toBe(404);
    expect((await j(await call(getRuns, ro, { id }))).data).toEqual([]);
  });
  it("PATCH leaves unmentioned fields alone; filters and steps replace wholesale", async () => {
    const before = await withTenant(kit.A, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) }));
    expect((await call(patchAutomation, kit.key, { id }, send("PATCH", { name: "Win back 2", description: "d" }))).status).toBe(200);
    const row = await withTenant(kit.A, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) }));
    expect(row).toMatchObject({ name: "Win back 2", description: "d", trigger: "no_visit", enabled: false, exitOnBooking: false });
    expect(row?.steps).toEqual(before?.steps);
    expect(row?.filters).toEqual(before?.filters);
    await call(patchAutomation, kit.key, { id }, send("PATCH", { filters: { days: 30 } }));
    expect((await withTenant(kit.A, (tx) => tx.query.workflows.findFirst({ where: eq(schema.workflows.id, id) })))?.filters).toMatchObject({ days: 30, tags: [] });
    expect((await call(patchAutomation, kit.key, { id }, send("PATCH", {}))).status).toBe(200);
  });
  it("PATCH: on/off switch, validation, foreign ids and other businesses' automations", async () => {
    expect((await j(await call(patchAutomation, kit.key, { id }, send("PATCH", { enabled: true })))).data.enabled).toBe(true);
    expect((await j(await call(patchAutomation, kit.key, { id }, send("PATCH", { enabled: false })))).data.enabled).toBe(false);
    expect((await call(patchAutomation, kit.key, { id }, send("PATCH", { steps: [] }))).status).toBe(422);
    expect((await call(patchAutomation, kit.key, { id }, send("PATCH", { trigger: "appointment_booked" }))).status).toBe(200); // steps still valid: wait + email
    expect((await call(patchAutomation, kit.key, { id }, send("PATCH", { filters: { staff_ids: [seed[`staff${kit.B}`]] } }))).status).toBe(404);
    expect((await call(patchAutomation, kit.key, { id: seed.bFlow! }, send("PATCH", { name: "Hacked", enabled: false }))).status).toBe(404);
    expect((await call(patchAutomation, kit.key, { id: seed.bFlow! }, send("PATCH", { enabled: false }))).status).toBe(404);
    expect(await bFlowNow()).toMatchObject({ name: "B flow", enabled: true });
  });
  it("duplicates (switched off) and refuses other businesses' automations", async () => {
    const r = await call(duplicateAutomation, kit.key, { id }, send("POST"));
    expect(r.status).toBe(201);
    const d = (await j(r)).data;
    expect(d).toMatchObject({ name: "Win back 2 (copy)", enabled: false });
    expect(d.id).not.toBe(id);
    const before = (await withTenant(kit.B, (tx) => tx.select().from(schema.workflows))).length;
    expect((await call(duplicateAutomation, kit.key, { id: seed.bFlow! }, send("POST"))).status).toBe(404);
    expect((await withTenant(kit.B, (tx) => tx.select().from(schema.workflows))).length).toBe(before);
    await call(deleteAutomation, kit.key, { id: d.id }, send("DELETE"));
  });
  it("deletes custom automations only; built-ins answer 409; other businesses' answer 404", async () => {
    expect((await call(deleteAutomation, kit.key, { id: seed.template! }, send("DELETE"))).status).toBe(409);
    expect((await call(getAutomation, ro, { id: seed.template! })).status).toBe(200);
    expect((await call(deleteAutomation, kit.key, { id: seed.bFlow! }, send("DELETE"))).status).toBe(404);
    expect(await bFlowNow()).toBeTruthy();
    expect((await call(deleteAutomation, kit.key, { id }, send("DELETE"))).status).toBe(200);
    expect((await call(getAutomation, ro, { id })).status).toBe(404);
  });
  it("needs the scope", async () => {
    expect((await call(listAutomations, nope)).status).toBe(403);
    expect((await call(postAutomation, ro, {}, send("POST", { name: "x", trigger: "birthday", steps: [{ type: "sms", body: "hi" }] }))).status).toBe(403);
    expect((await call(patchAutomation, ro, { id: seed.template! }, send("PATCH", { enabled: true }))).status).toBe(403);
    expect((await call(deleteAutomation, ro, { id: seed.template! }, send("DELETE"))).status).toBe(403);
    expect((await call(duplicateAutomation, ro, { id: seed.template! }, send("POST"))).status).toBe(403);
    expect((await call(getRuns, nope, { id: seed.template! })).status).toBe(403);
  });
});
