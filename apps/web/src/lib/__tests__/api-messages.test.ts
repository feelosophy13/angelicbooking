/**
 * Integration test for the messages API (delivery log, client replies, staff texts, resend). Needs Postgres at DATABASE_URL; skipped
 * otherwise. Nothing is delivered: `after` is stubbed and resendNotification is replaced by a spy, so texts only ever become queued rows.
 */
import "../../../../../packages/db/src/env"; // first: the db client reads DATABASE_URL (the RLS-bound app role) when it is created
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getSql, schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const resend = vi.hoisted(() => vi.fn(async () => ({ processed: 1, sent: 1, failed: 0, skipped: 0 })));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), resendNotification: resend, deliverMany: async () => ({ processed: 0, sent: 0, failed: 0, skipped: 0 }) }));

import { GET as listNotifications } from "@/app/api/v1/notifications/route";
import { GET as getNotification } from "@/app/api/v1/notifications/[id]/route";
import { POST as resendNotification } from "@/app/api/v1/notifications/[id]/resend/route";
import { GET as listMessages } from "@/app/api/v1/messages/route";
import { GET as getThread, POST as reply } from "@/app/api/v1/clients/[id]/messages/route";

const up = await reachable();
let kit: Awaited<ReturnType<typeof setupKit>>;
let ro: string;
let nope: string;
const seed: Record<string, string> = {};
const j = (r: Response) => r.json();

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit(["messages:write"]);
  ro = await mkKey(kit.A, ["messages:read"]);
  nope = await mkKey(kit.A, ["catalog:read"]);
  for (const b of [kit.A, kit.B]) {
    const [ok] = await withTenant(b, (tx) => tx.insert(schema.clients).values({ businessId: b, firstName: "Ok", phone: "+15555550100" }).returning());
    const [stopped] = await withTenant(b, (tx) => tx.insert(schema.clients).values({ businessId: b, firstName: "Stopped", phone: "+15555550101", smsOptIn: false }).returning());
    const [nophone] = await withTenant(b, (tx) => tx.insert(schema.clients).values({ businessId: b, firstName: "NoPhone" }).returning());
    seed[`ok${b}`] = ok!.id; seed[`stopped${b}`] = stopped!.id; seed[`nophone${b}`] = nophone!.id;
    const mk = (o: Partial<typeof schema.notifications.$inferInsert>) => ({ businessId: b, template: "confirmation", recipient: "+15555550100", body: "hello", ...o }) as typeof schema.notifications.$inferInsert;
    const rows = await withTenant(b, (tx) => tx.insert(schema.notifications).values([
      mk({ channel: "sms", status: "sent", clientId: ok!.id, providerId: "SM_secret_provider_id" }),
      mk({ channel: "email", status: "failed", recipient: "a@example.com", subject: "S", error: "boom", clientId: ok!.id }),
      mk({ channel: "sms", status: "queued" }),
    ]).returning());
    seed[`sent${b}`] = rows[0]!.id; seed[`failed${b}`] = rows[1]!.id; seed[`queued${b}`] = rows[2]!.id;
    await withTenant(b, (tx) => tx.insert(schema.inboundMessages).values([
      { businessId: b, clientId: ok!.id, fromNumber: "+15555550100", toNumber: "+15555559999", body: `reply ${b}` },
      { businessId: b, clientId: null, fromNumber: "+15555550177", toNumber: "+15555559999", body: `stranger ${b}`, readAt: new Date() },
    ]));
  }
});

afterAll(async () => {
  if (!up) return;
  await kit.teardown();
  await getSql().end();
});

const countNotifications = (b: string) => withTenant(b, (tx) => tx.select().from(schema.notifications)).then((r) => r.length);

describe.skipIf(!up)("delivery log", () => {
  it("lists only this business's messages, newest first, without provider internals", async () => {
    const r = await j(await call(listNotifications, ro));
    expect(r.data).toHaveLength(3);
    const text = JSON.stringify(r);
    expect(text).not.toContain("SM_secret_provider_id");
    expect(text).not.toContain("provider");
    expect(r.data.find((n: { id: string }) => n.id === seed[`failed${kit.A}`])).toMatchObject({ channel: "email", status: "failed", subject: "S", error: "boom", recipient: "a@example.com" });
    const ids = r.data.map((n: { id: string }) => n.id);
    expect(ids).not.toContain(seed[`sent${kit.B}`]);
  });
  it("filters by channel, status, client, and paging", async () => {
    const get = async (q: string) => (await j(await call(listNotifications, ro, {}, {}, `http://x/api/v1/notifications?${q}`))).data as { id: string }[];
    expect((await get("channel=email")).map((n) => n.id)).toEqual([seed[`failed${kit.A}`]]);
    expect((await get("status=queued")).map((n) => n.id)).toEqual([seed[`queued${kit.A}`]]);
    expect(await get(`client_id=${seed[`ok${kit.A}`]}`)).toHaveLength(2);
    expect(await get(`client_id=${seed[`ok${kit.B}`]}`)).toHaveLength(0); // another business's client id finds nothing
    expect(await get("limit=1")).toHaveLength(1);
    expect(await get("from=2999-01-01T00:00:00Z")).toHaveLength(0);
    expect(await get("status=bogus")).toHaveLength(3); // an unknown filter value is ignored
  });
  it("reads one message; another business's answers 404", async () => {
    expect((await call(getNotification, ro, { id: seed[`sent${kit.A}`]! })).status).toBe(200);
    expect((await call(getNotification, ro, { id: seed[`sent${kit.B}`]! })).status).toBe(404);
  });
  it("resends a failed message through the app's function, and only that", async () => {
    resend.mockClear();
    const ok = await call(resendNotification, kit.key, { id: seed[`failed${kit.A}`]! }, send("POST"));
    expect(ok.status).toBe(200);
    expect(resend).toHaveBeenCalledWith(kit.A, seed[`failed${kit.A}`]);
    expect((await j(ok)).data).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    resend.mockClear();
    expect((await call(resendNotification, kit.key, { id: seed[`sent${kit.A}`]! }, send("POST"))).status).toBe(409);
    expect((await call(resendNotification, kit.key, { id: seed[`queued${kit.A}`]! }, send("POST"))).status).toBe(409);
    expect(resend).not.toHaveBeenCalled();
  });
  it("cannot resend another business's message", async () => {
    resend.mockClear();
    expect((await call(resendNotification, kit.key, { id: seed[`failed${kit.B}`]! }, send("POST"))).status).toBe(404);
    expect(resend).not.toHaveBeenCalled();
    const b = await withTenant(kit.B, (tx) => tx.query.notifications.findFirst({ where: eq(schema.notifications.id, seed[`failed${kit.B}`]!) }));
    expect(b?.status).toBe("failed");
  });
  it("needs the scope", async () => {
    expect((await call(listNotifications, nope)).status).toBe(403);
    expect((await call(getNotification, nope, { id: seed[`sent${kit.A}`]! })).status).toBe(403);
    expect((await call(resendNotification, ro, { id: seed[`failed${kit.A}`]! }, send("POST"))).status).toBe(403);
  });
});

describe.skipIf(!up)("client replies", () => {
  it("lists inbound texts for this business only, with filters", async () => {
    const all = (await j(await call(listMessages, ro))).data as { body: string; client_name: string | null }[];
    expect(all.map((m) => m.body).sort()).toEqual([`reply ${kit.A}`, `stranger ${kit.A}`]);
    expect(all.find((m) => m.body.startsWith("reply"))?.client_name).toBe("Ok");
    const get = async (q: string) => (await j(await call(listMessages, ro, {}, {}, `http://x/api/v1/messages?${q}`))).data as { body: string }[];
    expect((await get(`client_id=${seed[`ok${kit.A}`]}`)).map((m) => m.body)).toEqual([`reply ${kit.A}`]);
    expect(await get(`client_id=${seed[`ok${kit.B}`]}`)).toHaveLength(0);
    expect((await get("unread=true")).map((m) => m.body)).toEqual([`reply ${kit.A}`]);
  });
  it("shows a client's conversation; another business's client answers 404", async () => {
    const t = (await j(await call(getThread, ro, { id: seed[`ok${kit.A}`]! }))).data as { direction: string }[];
    expect(t.map((m) => m.direction).sort()).toEqual(["inbound", "outbound"]);
    expect((await call(getThread, ro, { id: seed[`ok${kit.B}`]! })).status).toBe(404);
  });
  it("needs the scope", async () => {
    expect((await call(listMessages, nope)).status).toBe(403);
    expect((await call(getThread, nope, { id: seed[`ok${kit.A}`]! })).status).toBe(403);
  });
});

describe.skipIf(!up)("texting a client", () => {
  const say = (key: string, id: string, body: unknown) => call(reply, key, { id }, send("POST", body));
  it("queues a staff reply like the client page does", async () => {
    const before = await countNotifications(kit.A);
    const r = await say(kit.key, seed[`ok${kit.A}`]!, { body: "  See you at 3!  " });
    expect(r.status).toBe(201);
    expect(await countNotifications(kit.A)).toBe(before + 1);
    const row = (await withTenant(kit.A, (tx) => tx.select().from(schema.notifications))).find((n) => n.template === "staff_reply");
    expect(row).toMatchObject({ channel: "sms", status: "queued", body: "See you at 3!", recipient: "+15555550100", clientId: seed[`ok${kit.A}`] });
  });
  it("answers 409 with the app's message for an opted-out client or one without a number, and queues nothing", async () => {
    const before = await countNotifications(kit.A);
    const stopped = await say(kit.key, seed[`stopped${kit.A}`]!, { body: "hi" });
    expect(stopped.status).toBe(409);
    expect((await j(stopped)).error.message).toBe("This client has opted out of texts.");
    const none = await say(kit.key, seed[`nophone${kit.A}`]!, { body: "hi" });
    expect(none.status).toBe(409);
    expect((await j(none)).error.message).toBe("This client has no mobile number.");
    expect(await countNotifications(kit.A)).toBe(before);
  });
  it("cannot text another business's client", async () => {
    const before = await countNotifications(kit.B);
    expect((await say(kit.key, seed[`ok${kit.B}`]!, { body: "hi" })).status).toBe(404);
    expect(await countNotifications(kit.B)).toBe(before);
  });
  it("validates the body (422); it takes no ids, so there is nothing foreign to name", async () => {
    const id = seed[`ok${kit.A}`]!;
    const before = await countNotifications(kit.A);
    for (const bad of [{}, { body: "" }, { body: "   " }, { body: "x".repeat(1001) }, { body: "hi", client_id: seed[`ok${kit.B}`] }, { body: 5 }]) expect((await say(kit.key, id, bad)).status).toBe(422);
    expect(await countNotifications(kit.A)).toBe(before);
  });
  it("needs the write scope", async () => {
    const before = await countNotifications(kit.A);
    expect((await say(ro, seed[`ok${kit.A}`]!, { body: "hi" })).status).toBe(403);
    expect((await say(nope, seed[`ok${kit.A}`]!, { body: "hi" })).status).toBe(403);
    expect(await countNotifications(kit.A)).toBe(before);
  });
});
