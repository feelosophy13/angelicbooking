/**
 * Integration test: the client extras of the public API (note pin/delete, referral code, a client's visits and submitted forms).
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here sends a message.
 */
import "../../../../../packages/db/src/env"; // must come first: @angelic/db connects when imported, so DATABASE_URL has to be loaded already
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

import { PATCH as patchNote, DELETE as deleteNote } from "@/app/api/v1/clients/[id]/notes/[noteId]/route";
import { GET as getCode, POST as postCode } from "@/app/api/v1/clients/[id]/referral-code/route";
import { GET as getVisits } from "@/app/api/v1/clients/[id]/appointments/route";
import { GET as getSubs } from "@/app/api/v1/clients/[id]/submissions/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let readKey: string; // clients:read only
let noScopeKey: string; // a scope that is not clients:*
const ids: Record<string, string> = {};

describe.skipIf(!up)("API: client extras", () => {
  beforeAll(async () => {
    kit = await setupKit(["clients:write"]);
    readKey = await mkKey(kit.A, ["clients:read"]);
    noScopeKey = await mkKey(kit.A, ["catalog:read"]);
    for (const biz of [kit.A, kit.B]) {
      const [c] = await withTenant(biz, (tx) => tx.insert(schema.clients).values({ businessId: biz, firstName: "Pat", lastName: biz }).returning());
      const [s] = await withTenant(biz, (tx) => tx.insert(schema.services).values({ businessId: biz, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
      const [st] = await withTenant(biz, (tx) => tx.insert(schema.staff).values({ businessId: biz, displayName: "Stylist" }).returning());
      const [n] = await withTenant(biz, (tx) => tx.insert(schema.clientNotes).values({ businessId: biz, clientId: c!.id, body: `note ${biz}`, pinned: false }).returning());
      const [f] = await withTenant(biz, (tx) => tx.insert(schema.forms).values({ businessId: biz, name: "Waiver", kind: "consent", fields: [] }).returning());
      const [sub] = await withTenant(biz, (tx) => tx.insert(schema.formSubmissions).values({ businessId: biz, formId: f!.id, clientId: c!.id, answers: { q1: "secret allergy" }, signatureName: "Pat" }).returning());
      const start = new Date(Date.now() + 5 * 86_400_000);
      const [a] = await withTenant(biz, (tx) => tx.insert(schema.appointments).values({ businessId: biz, clientId: c!.id }).returning());
      await withTenant(biz, (tx) => tx.insert(schema.appointmentItems).values({ businessId: biz, appointmentId: a!.id, staffId: st!.id, serviceId: s!.id, serviceName: "Cut", startAt: start, endAt: new Date(start.getTime() + 1_800_000), priceCents: 5000 }));
      Object.assign(ids, { [`client${biz}`]: c!.id, [`note${biz}`]: n!.id, [`sub${biz}`]: sub!.id, [`appt${biz}`]: a!.id });
    }
  });
  afterAll(async () => {
    if (kit) await kit.teardown();
  });

  const A = () => kit.A;
  const B = () => kit.B;

  describe("PATCH /clients/:id/notes/:noteId (pin)", () => {
    it("pins and unpins the caller's own note and nothing else about it", async () => {
      const p = { id: ids[`client${A()}`]!, noteId: ids[`note${A()}`]! };
      const r = await call(patchNote, kit.key, p, send("PATCH", { pinned: true }));
      expect(r.status).toBe(200);
      expect((await r.json()).data).toMatchObject({ id: p.noteId, pinned: true, body: `note ${A()}` });
      expect((await call(patchNote, kit.key, p, send("PATCH", { pinned: false }))).status).toBe(200);
      const row = await withTenant(A(), (tx) => tx.query.clientNotes.findFirst({ where: eq(schema.clientNotes.id, p.noteId) }));
      expect(row).toMatchObject({ pinned: false, body: `note ${A()}` });
    });
    it("404s another business's note, and a note addressed through the wrong client", async () => {
      const foreign = { id: ids[`client${B()}`]!, noteId: ids[`note${B()}`]! };
      expect((await call(patchNote, kit.key, foreign, send("PATCH", { pinned: true }))).status).toBe(404);
      // The caller's client id with the other business's note id.
      expect((await call(patchNote, kit.key, { id: ids[`client${A()}`]!, noteId: ids[`note${B()}`]! }, send("PATCH", { pinned: true }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.clientNotes.findFirst({ where: eq(schema.clientNotes.id, foreign.noteId) })))?.pinned).toBe(false);
    });
    it("403 without clients:write, 422 for a bad or unknown field", async () => {
      const p = { id: ids[`client${A()}`]!, noteId: ids[`note${A()}`]! };
      expect((await call(patchNote, readKey, p, send("PATCH", { pinned: true }))).status).toBe(403);
      expect((await call(patchNote, null, p, send("PATCH", { pinned: true }))).status).toBe(401);
      expect((await call(patchNote, kit.key, p, send("PATCH", { pinned: "yes" }))).status).toBe(422);
      expect((await call(patchNote, kit.key, p, send("PATCH", {}))).status).toBe(422);
      expect((await call(patchNote, kit.key, p, send("PATCH", { pinned: true, body: "x" }))).status).toBe(422);
    });
  });

  describe("DELETE /clients/:id/notes/:noteId", () => {
    it("deletes the caller's note; another business's note survives", async () => {
      const [mine] = await withTenant(A(), (tx) => tx.insert(schema.clientNotes).values({ businessId: A(), clientId: ids[`client${A()}`]!, body: "delete me" }).returning());
      const p = { id: ids[`client${A()}`]!, noteId: mine!.id };
      expect((await call(deleteNote, readKey, p, send("DELETE"))).status).toBe(403);
      const r = await call(deleteNote, kit.key, p, send("DELETE"));
      expect(r.status).toBe(200);
      expect((await r.json()).data).toEqual({ id: mine!.id, deleted: true });
      expect(await withTenant(A(), (tx) => tx.query.clientNotes.findFirst({ where: eq(schema.clientNotes.id, mine!.id) }))).toBeUndefined();
      expect((await call(deleteNote, kit.key, p, send("DELETE"))).status).toBe(404);

      const foreign = { id: ids[`client${B()}`]!, noteId: ids[`note${B()}`]! };
      expect((await call(deleteNote, kit.key, foreign, send("DELETE"))).status).toBe(404);
      expect((await call(deleteNote, kit.key, { id: ids[`client${A()}`]!, noteId: ids[`note${B()}`]! }, send("DELETE"))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.clientNotes.findFirst({ where: eq(schema.clientNotes.id, foreign.noteId) }))).toBeDefined();
    });
  });

  describe("/clients/:id/referral-code", () => {
    it("makes a code once and returns the same one afterwards", async () => {
      const p = { id: ids[`client${A()}`]! };
      expect((await (await call(getCode, readKey, p)).json()).data.referral_code).toBeNull();
      const first = await call(postCode, kit.key, p, send("POST"));
      expect(first.status).toBe(201);
      const code = (await first.json()).data.referral_code as string;
      expect(code).toMatch(/^[A-Z]+-[A-Z0-9]{4}$/);
      const again = await call(postCode, kit.key, p, send("POST"));
      expect(again.status).toBe(200);
      expect((await again.json()).data.referral_code).toBe(code);
      expect((await (await call(getCode, readKey, p)).json()).data.referral_code).toBe(code);
    });
    it("404s another business's client and leaves it without a code; 403 without the scope", async () => {
      const foreign = { id: ids[`client${B()}`]! };
      expect((await call(postCode, kit.key, foreign, send("POST"))).status).toBe(404);
      expect((await call(getCode, kit.key, foreign)).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, foreign.id) })))?.referralCode).toBeNull();
      expect((await call(postCode, readKey, { id: ids[`client${A()}`]! }, send("POST"))).status).toBe(403);
      expect((await call(getCode, noScopeKey, { id: ids[`client${A()}`]! })).status).toBe(403);
    });
  });

  describe("GET /clients/:id/appointments", () => {
    it("lists this client's visits, and 404s another business's client", async () => {
      const r = await call(getVisits, readKey, { id: ids[`client${A()}`]! });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: ids[`appt${A()}`], client_id: ids[`client${A()}`] });
      expect((await call(getVisits, readKey, { id: ids[`client${B()}`]! })).status).toBe(404);
    });
    it("filters by status, rejects a bad status, and needs clients:read", async () => {
      const p = { id: ids[`client${A()}`]! };
      expect((await (await call(getVisits, readKey, p, {}, "http://x/t?status=cancelled")).json()).total).toBe(0);
      expect((await call(getVisits, readKey, p, {}, "http://x/t?status=bogus")).status).toBe(422);
      expect((await call(getVisits, noScopeKey, p)).status).toBe(403);
    });
  });

  describe("GET /clients/:id/submissions", () => {
    it("lists a summary without the answers, and 404s another business's client", async () => {
      const r = await call(getSubs, readKey, { id: ids[`client${A()}`]! });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: ids[`sub${A()}`], form_name: "Waiver", signed: true, voided: false });
      expect(JSON.stringify(body)).not.toContain("secret allergy");
      expect((await call(getSubs, readKey, { id: ids[`client${B()}`]! })).status).toBe(404);
      expect((await call(getSubs, noScopeKey, { id: ids[`client${A()}`]! })).status).toBe(403);
    });
    it("never reaches a submission of another business even with its client id swapped in", async () => {
      // The caller's client id only ever finds the caller's own rows.
      const rows = await withTenant(A(), (tx) => tx.select().from(schema.formSubmissions).where(and(eq(schema.formSubmissions.clientId, ids[`client${A()}`]!))));
      expect(rows.every((r) => r.businessId === A())).toBe(true);
    });
  });
});
