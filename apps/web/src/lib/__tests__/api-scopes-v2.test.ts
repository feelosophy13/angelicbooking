/**
 * Integration test for the finer scopes: exact scopes (write does not read), extra scopes for sensitive fields, separate delete/send scopes,
 * the allowed-addresses list, the per-key rate limit, and that older keys keep every ability. Needs Postgres at DATABASE_URL; skipped otherwise.
 */
import "../../../../../packages/db/src/env"; // first: the db client reads DATABASE_URL (the RLS-bound app role) when it is created
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

import { GET as getClients, POST as postClient } from "@/app/api/v1/clients/route";
import { GET as getClient, PATCH as patchClient } from "@/app/api/v1/clients/[id]/route";
import { GET as getNotes, POST as postNote, } from "@/app/api/v1/clients/[id]/notes/route";
import { DELETE as deleteNote } from "@/app/api/v1/clients/[id]/notes/[noteId]/route";
import { POST as postService } from "@/app/api/v1/services/route";
import { PATCH as patchService } from "@/app/api/v1/services/[id]/route";
import { PUT as putStaffServices } from "@/app/api/v1/staff/[id]/services/route";
import { DELETE as deleteCategory } from "@/app/api/v1/categories/[id]/route";
import { POST as postPromo } from "@/app/api/v1/promo-codes/route";
import { POST as postCampaign } from "@/app/api/v1/campaigns/route";
import { POST as sendCampaign } from "@/app/api/v1/campaigns/[id]/send/route";
import { POST as postAutomation } from "@/app/api/v1/automations/route";
import { PATCH as patchAutomation } from "@/app/api/v1/automations/[id]/route";
import { PATCH as patchAppointment } from "@/app/api/v1/appointments/[id]/route";
import { POST as cancelAppointment } from "@/app/api/v1/appointments/[id]/cancel/route";
import { DELETE as deleteBlock } from "@/app/api/v1/blocks/[id]/route";
import { PATCH as patchBooking } from "@/app/api/v1/settings/booking/route";
import { PATCH as patchProfile } from "@/app/api/v1/settings/profile/route";
import { POST as resend } from "@/app/api/v1/notifications/[id]/resend/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
const ids: Record<string, string> = {};
const v2 = (scopes: string[], opts = {}) => mkKey(kit.A, scopes, { version: 2, ...opts });
const j = async (r: Response) => r.json();

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit([]);
  const A = kit.A;
  const [client] = await withTenant(A, (tx) => tx.insert(schema.clients).values({ businessId: A, firstName: "Cleo", email: "cleo@example.com", notes: "allergic to latex", storeCreditCents: 500, smsOptIn: false }).returning());
  const [service] = await withTenant(A, (tx) => tx.insert(schema.services).values({ businessId: A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
  const [staff] = await withTenant(A, (tx) => tx.insert(schema.staff).values({ businessId: A, displayName: "Sam" }).returning());
  const [cat] = await withTenant(A, (tx) => tx.insert(schema.serviceCategories).values({ businessId: A, name: "Hair" }).returning());
  const [note] = await withTenant(A, (tx) => tx.insert(schema.clientNotes).values({ businessId: A, clientId: client!.id, body: "n" }).returning());
  Object.assign(ids, { client: client!.id, service: service!.id, staff: staff!.id, cat: cat!.id, note: note!.id });
});
afterAll(async () => { if (up) await kit.teardown(); });

describe.skipIf(!up)("exact scopes", () => {
  it("write does not read: a create-only key cannot list or open clients", async () => {
    const k = await v2(["clients:write"]);
    const made = await call(postClient, k, {}, send("POST", { first_name: "New" }));
    expect(made.status).toBe(201);
    expect((await call(getClients, k)).status).toBe(403);
    expect((await call(getClient, k, { id: ids.client! })).status).toBe(403);
    expect((await call(patchClient, k, { id: ids.client! }, send("PATCH", { last_name: "Z" }))).status).toBe(200);
  });
  it("an older key (version 1) with write still reads, as before", async () => {
    const k = await mkKey(kit.A, ["clients:write"]);
    expect((await call(getClients, k)).status).toBe(200);
    expect((await call(getClient, k, { id: ids.client! })).status).toBe(200);
  });
  it("book, change and cancel are separate", async () => {
    const book = await v2(["appointments:book"]);
    const nope = (r: Response) => expect(r.status).toBe(403);
    nope(await call(patchAppointment, book, { id: "x" }, send("PATCH", { notes: "n" })));
    nope(await call(cancelAppointment, book, { id: "x" }, send("POST", { reason: "test" })));
    nope(await call(deleteBlock, await v2(["appointments:change"]), { id: "x" }, send("DELETE")));
    const cancelOnly = await v2(["appointments:cancel"]);
    nope(await call(patchAppointment, cancelOnly, { id: "x" }, send("PATCH", { notes: "n" })));
    expect((await call(cancelAppointment, cancelOnly, { id: "does-not-exist" }, send("POST", { reason: "test" }))).status).toBe(404); // allowed in, then not found
    expect((await call(cancelAppointment, cancelOnly, { id: "does-not-exist" }, send("POST", {}))).status).toBe(422); // a reason is required
  });
});

describe.skipIf(!up)("client fields", () => {
  it("private notes and balances are left out unless the key may see them", async () => {
    const plain = (await j(await call(getClient, await v2(["clients:read"]), { id: ids.client! }))).data;
    expect(plain).not.toHaveProperty("notes");
    expect(plain).not.toHaveProperty("store_credit_cents");
    expect(plain.first_name).toBe("Cleo");
    const full = (await j(await call(getClient, await v2(["clients:read", "client-notes:read", "clients:balances"]), { id: ids.client! }))).data;
    expect(full.notes).toBe("allergic to latex");
    expect(full.store_credit_cents).toBe(500);
    const list = (await j(await call(getClients, await v2(["clients:read"])))).data;
    expect(list.every((c: object) => !("notes" in c) && !("store_credit_cents" in c))).toBe(true);
  });
  it("consent flags need clients:consent, notes need client-notes:write; a tool that omits them does not", async () => {
    const k = await v2(["clients:write"]);
    const unchanged = async () => (await withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, ids.client!) })))!;
    expect((await call(patchClient, k, { id: ids.client! }, send("PATCH", { sms_opt_in: true }))).status).toBe(403);
    expect((await call(patchClient, k, { id: ids.client! }, send("PATCH", { email_opt_in: false }))).status).toBe(403);
    expect((await call(patchClient, k, { id: ids.client! }, send("PATCH", { notes: "changed" }))).status).toBe(403);
    expect((await call(postClient, k, {}, send("POST", { first_name: "Eve", sms_opt_in: true }))).status).toBe(403);
    const c = await unchanged();
    expect([c.smsOptIn, c.emailOptIn, c.notes]).toEqual([false, true, "allergic to latex"]);
    const withConsent = await v2(["clients:write", "clients:consent"]);
    expect((await call(patchClient, withConsent, { id: ids.client! }, send("PATCH", { sms_opt_in: true }))).status).toBe(200);
    expect((await unchanged()).smsOptIn).toBe(true);
    const withNotes = await v2(["clients:write", "client-notes:write"]);
    expect((await call(patchClient, withNotes, { id: ids.client! }, send("PATCH", { notes: "changed" }))).status).toBe(200);
    expect((await unchanged()).notes).toBe("changed");
  });
  it("note delete is its own scope", async () => {
    expect((await call(deleteNote, await v2(["client-notes:write"]), { id: ids.client!, noteId: ids.note! }, send("DELETE"))).status).toBe(403);
    expect((await call(getNotes, await v2(["client-notes:write"]), { id: ids.client! })).status).toBe(403); // write does not read
    expect((await call(postNote, await v2(["client-notes:write"]), { id: ids.client! }, send("POST", { body: "more" }))).status).toBe(201);
    expect((await call(deleteNote, await v2(["client-notes:delete"]), { id: ids.client!, noteId: ids.note! }, send("DELETE"))).status).toBe(200);
  });
});

describe.skipIf(!up)("prices", () => {
  it("changing or setting a price needs pricing:write; the rest of a service does not", async () => {
    const k = await v2(["catalog:write"]);
    expect((await call(patchService, k, { id: ids.service! }, send("PATCH", { name: "Cut & style" }))).status).toBe(200);
    for (const body of [{ price_cents: 1 }, { deposit_cents: 100 }, { deposit_type: "full" }]) {
      expect((await call(patchService, k, { id: ids.service! }, send("PATCH", body))).status).toBe(403);
    }
    expect((await call(postService, k, {}, send("POST", { name: "New", duration_min: 30, price_cents: 100 }))).status).toBe(403);
    const s = await withTenant(kit.A, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, ids.service!) }));
    expect([s?.name, s?.priceCents, s?.depositCents]).toEqual(["Cut & style", 5000, 0]);
    const priced = await v2(["catalog:write", "pricing:write"]);
    expect((await call(patchService, priced, { id: ids.service! }, send("PATCH", { price_cents: 6000 }))).status).toBe(200);
    expect((await call(postService, priced, {}, send("POST", { name: "New", duration_min: 30, price_cents: 100 }))).status).toBe(201);
  });
  it("a stylist's own price (nested in the body) needs pricing:write too", async () => {
    const k = await v2(["staff:write"]);
    const body = { services: [{ service_id: ids.service!, price_cents: 10 }] };
    expect((await call(putStaffServices, k, { id: ids.staff! }, send("PUT", body))).status).toBe(403);
    expect((await call(putStaffServices, k, { id: ids.staff! }, send("PUT", { services: [{ service_id: ids.service! }] }))).status).toBe(200);
    expect((await call(putStaffServices, await v2(["staff:write", "pricing:write"]), { id: ids.staff! }, send("PUT", body))).status).toBe(200);
  });
  it("promo codes (they change what clients pay) need pricing:write as well", async () => {
    const body = { code: "SPRING", type: "percent", value: 10 };
    expect((await call(postPromo, await v2(["marketing:write"]), {}, send("POST", body))).status).toBe(403);
    expect((await call(postPromo, await v2(["marketing:write", "pricing:write"]), {}, send("POST", body))).status).toBe(201);
  });
});

describe.skipIf(!up)("delete, send and policies", () => {
  it("deleting a category needs catalog:delete, not catalog:write", async () => {
    expect((await call(deleteCategory, await v2(["catalog:write"]), { id: ids.cat! }, send("DELETE"))).status).toBe(403);
    expect((await withTenant(kit.A, (tx) => tx.query.serviceCategories.findFirst({ where: eq(schema.serviceCategories.id, ids.cat!) })))).toBeTruthy();
    expect((await call(deleteCategory, await v2(["catalog:delete"]), { id: ids.cat! }, send("DELETE"))).status).toBe(200);
  });
  it("drafting a campaign is marketing:write, sending it is campaigns:send", async () => {
    const draft = await v2(["marketing:write"]);
    const made = await call(postCampaign, draft, {}, send("POST", { name: "Hi", channel: "email", subject: "Hi", body: "Hello" }));
    expect(made.status).toBe(201);
    const id = (await j(made)).data.id as string;
    expect((await call(sendCampaign, draft, { id }, send("POST"))).status).toBe(403);
    expect((await withTenant(kit.A, (tx) => tx.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) })))?.status).toBe("draft");
  });
  it("switching an automation ON needs campaigns:send; leaving it off or turning it off does not", async () => {
    const k = await v2(["marketing:write"]);
    const body = { name: "Bday", trigger: "birthday", steps: [{ type: "sms", body: "Happy birthday" }] };
    expect((await call(postAutomation, k, {}, send("POST", { ...body, enabled: true }))).status).toBe(403);
    const made = await call(postAutomation, k, {}, send("POST", body));
    expect(made.status).toBe(201);
    const id = (await j(made)).data.id as string;
    expect((await call(patchAutomation, k, { id }, send("PATCH", { enabled: true }))).status).toBe(403);
    expect((await call(patchAutomation, k, { id }, send("PATCH", { enabled: false }))).status).toBe(200);
    expect((await call(patchAutomation, await v2(["marketing:write", "campaigns:send"]), { id }, send("PATCH", { enabled: true }))).status).toBe(200);
  });
  it("booking rules and fees are policies:write; the business name is settings:write", async () => {
    const k = await v2(["settings:write"]);
    expect((await call(patchBooking, k, {}, send("PATCH", { no_show_fee_cents: 5000 }))).status).toBe(403);
    expect((await call(patchProfile, k, {}, send("PATCH", { about: "We do hair" }))).status).not.toBe(403);
    expect((await call(patchBooking, await v2(["policies:write"]), {}, send("PATCH", { no_show_fee_cents: 5000 }))).status).not.toBe(403);
  });
  it("resending a failed message is messages:resend, not messages:write", async () => {
    expect((await call(resend, await v2(["messages:write"]), { id: "x" }, send("POST"))).status).toBe(403);
  });
});

describe.skipIf(!up)("allowed addresses and rate limit", () => {
  const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
  it("only the listed addresses may use the key; anywhere else it looks like a wrong key", async () => {
    const k = await v2(["clients:read"], { allowedIps: ["203.0.113.7", "198.51.100.0/24"] });
    expect((await call(getClients, k, {}, from("203.0.113.7"))).status).toBe(200);
    expect((await call(getClients, k, {}, from("198.51.100.99"))).status).toBe(200);
    for (const ip of ["203.0.113.8", "192.0.2.1"]) {
      const r = await call(getClients, k, {}, from(ip));
      expect(r.status).toBe(401);
      expect((await j(r)).error.code).toBe("invalid_api_key");
    }
  });
  it("uses the address our proxy added (the last entry), so a claimed first entry proves nothing", async () => {
    const k = await v2(["clients:read"], { allowedIps: ["203.0.113.7"] });
    expect((await call(getClients, k, {}, from("203.0.113.7, 192.0.2.50"))).status).toBe(401); // caller claims an allowed address first
    expect((await call(getClients, k, {}, from("192.0.2.50, 203.0.113.7"))).status).toBe(200); // the proxy saw 203.0.113.7
  });
  it("a key can be limited to fewer requests per minute", async () => {
    const k = await v2(["catalog:read"], { rateLimitPerMin: 30 });
    const { GET: getBusiness } = await import("@/app/api/v1/business/route");
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) last = await call(getBusiness, k);
    expect(last!.status).toBe(200);
    expect(last!.headers.get("X-RateLimit-Limit")).toBe("30");
    const over = await call(getBusiness, k);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBeTruthy();
  });
});
