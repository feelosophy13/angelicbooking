/**
 * Integration test: an API key reaches only its own business. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, getSql, schema, withTenant } from "@angelic/db";
import { generateKey } from "../api";

import { GET as getClients, POST as postClient } from "@/app/api/v1/clients/route";
import { GET as getClient, PATCH as patchClient } from "@/app/api/v1/clients/[id]/route";
import { POST as postAppt } from "@/app/api/v1/appointments/route";
import { GET as getAppt } from "@/app/api/v1/appointments/[id]/route";
import { POST as cancelAppt } from "@/app/api/v1/appointments/[id]/cancel/route";
import { GET as getSale } from "@/app/api/v1/sales/[id]/route";
import { GET as getStaff } from "@/app/api/v1/staff/route";

const A = `api_a_${crypto.randomUUID().slice(0, 8)}`;
const B = `api_b_${crypto.randomUUID().slice(0, 8)}`;
let reachable = true;
const keys: Record<string, string> = {};
const ids: Record<string, string> = {};

const call = <P>(h: (r: Request, c: { params: Promise<P> }) => Promise<Response>, key: string | null, params: P = {} as P, init: RequestInit = {}, url = "http://x/api/v1/t") =>
  h(new Request(url, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }), { params: Promise.resolve(params) });

async function mkKey(businessId: string, name: string, scopes: string[], extra: Partial<typeof schema.apiKeys.$inferInsert> = {}) {
  const k = generateKey();
  await withTenant(businessId, (tx) => tx.insert(schema.apiKeys).values({ businessId, name, prefix: k.prefix, keyHash: k.hash, scopes, ...extra }));
  return k.key;
}

beforeAll(async () => {
  try {
    await getSql()`select 1`;
    await getSql()`select 1 from api_keys limit 1`;
  } catch {
    reachable = false;
    return;
  }
  for (const id of [A, B]) {
    await db.insert(schema.organization).values({ id, name: id, slug: id });
    await db.insert(schema.businesses).values({ id, name: id, slug: id });
  }
  for (const id of [A, B]) {
    const [c] = await withTenant(id, (tx) => tx.insert(schema.clients).values({ businessId: id, firstName: `Client${id}`, email: `${id}@example.com` }).returning());
    const [s] = await withTenant(id, (tx) => tx.insert(schema.services).values({ businessId: id, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
    const [st] = await withTenant(id, (tx) => tx.insert(schema.staff).values({ businessId: id, displayName: `Staff${id}`, fullName: "Private Name", clockPinHash: "secret" }).returning());
    ids[`client${id}`] = c!.id; ids[`service${id}`] = s!.id; ids[`staff${id}`] = st!.id;
    const [sale] = await withTenant(id, (tx) => tx.insert(schema.sales).values({ businessId: id, number: 1 }).returning());
    ids[`sale${id}`] = sale!.id;
  }
  keys.aAll = await mkKey(A, "all", ["catalog:read", "clients:write", "appointments:write", "sales:read"]);
  keys.aRead = await mkKey(A, "ro", ["clients:read"]);
  keys.bAll = await mkKey(B, "all", ["catalog:read", "clients:write", "appointments:write", "sales:read"]);
  keys.revoked = await mkKey(A, "rev", ["clients:read"], { revokedAt: new Date() });
  keys.expired = await mkKey(A, "exp", ["clients:read"], { expiresAt: new Date(Date.now() - 1000) });
});

afterAll(async () => {
  if (!reachable) return;
  for (const id of [A, B]) await db.delete(schema.organization).where(eq(schema.organization.id, id));
  await getSql().end();
});

describe.skipIf(!reachable)("API isolation", () => {
  it("rejects missing, malformed, unknown, revoked and expired keys the same way", async () => {
    for (const k of [null, "nope", "ab_live_unknown", keys.revoked!, keys.expired!]) {
      const r = await call(getClients, k);
      expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe("invalid_api_key");
    }
  });
  it("rejects a key whose business is suspended", async () => {
    await db.update(schema.businesses).set({ suspendedAt: new Date() }).where(eq(schema.businesses.id, B));
    expect((await call(getClients, keys.bAll!)).status).toBe(401);
    await db.update(schema.businesses).set({ suspendedAt: null }).where(eq(schema.businesses.id, B));
    expect((await call(getClients, keys.bAll!)).status).toBe(200);
  });
  it("enforces scopes", async () => {
    expect((await call(getClients, keys.aRead!)).status).toBe(200);
    expect((await call(postClient, keys.aRead!, {}, { method: "POST", body: JSON.stringify({ first_name: "X" }) })).status).toBe(403);
    expect((await call(getSale, keys.aRead!, { id: ids[`sale${A}`]! })).status).toBe(403);
  });
  it("lists only the key's own business", async () => {
    const body = await (await call(getClients, keys.aAll!)).json();
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([ids[`client${A}`]]);
  });
  it("answers 404 for another business's ids on every read and write", async () => {
    const other = ids[`client${B}`]!;
    expect((await call(getClient, keys.aAll!, { id: other })).status).toBe(404);
    expect((await call(patchClient, keys.aAll!, { id: other }, { method: "PATCH", body: JSON.stringify({ first_name: "Hacked" }) })).status).toBe(404);
    expect((await call(getSale, keys.aAll!, { id: ids[`sale${B}`]! })).status).toBe(404);
    const stillB = await withTenant(B, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, other) }));
    expect(stillB?.firstName).toBe(`Client${B}`);
  });
  it("cannot book with another business's client, service or staff", async () => {
    const start = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const ok = { client_id: ids[`client${A}`], service_id: ids[`service${A}`], staff_id: ids[`staff${A}`], start_at: start, notify: false };
    for (const bad of [{ client_id: ids[`client${B}`] }, { service_id: ids[`service${B}`] }, { staff_id: ids[`staff${B}`] }]) {
      const r = await call(postAppt, keys.aAll!, {}, { method: "POST", body: JSON.stringify({ ...ok, ...bad }) });
      expect(r.status).toBe(404);
    }
    expect(await withTenant(A, (tx) => tx.select().from(schema.appointments))).toHaveLength(0);
  });
  it("cannot read or cancel another business's appointment", async () => {
    const [appt] = await withTenant(B, (tx) => tx.insert(schema.appointments).values({ businessId: B }).returning());
    expect((await call(getAppt, keys.aAll!, { id: appt!.id })).status).toBe(404);
    expect((await call(cancelAppt, keys.aAll!, { id: appt!.id }, { method: "POST", body: "{}" })).status).toBe(404);
    const after = await withTenant(B, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appt!.id) }));
    expect(after?.status).toBe("booked");
  });
  it("never exposes private staff fields", async () => {
    const text = JSON.stringify(await (await call(getStaff, keys.aAll!)).json());
    expect(text).toContain(`Staff${A}`);
    for (const secret of ["Private Name", "clock_pin", "secret", "calendar_token", "commission", "rate"]) expect(text).not.toContain(secret);
  });
  it("a tenant-scoped session cannot enumerate api_keys of another business", async () => {
    const seen = await withTenant(A, (tx) => tx.select({ id: schema.apiKeys.id, b: schema.apiKeys.businessId }).from(schema.apiKeys));
    expect(seen.every((r) => r.b === A)).toBe(true);
    expect(await db.select().from(schema.apiKeys)).toHaveLength(0);
  });
});
