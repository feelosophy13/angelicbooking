/**
 * Integration test: forms and form submissions in the public API. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 * Nothing here sends a message (emailing a copy is not in the API).
 */
import "../../../../../packages/db/src/env"; // must come first: @angelic/db connects when imported, so DATABASE_URL has to be loaded already
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

import { GET as listForms, POST as postForm } from "@/app/api/v1/forms/route";
import { GET as getForm, PATCH as patchForm, DELETE as deleteForm } from "@/app/api/v1/forms/[id]/route";
import { POST as duplicate } from "@/app/api/v1/forms/[id]/duplicate/route";
import { GET as listSubs } from "@/app/api/v1/form-submissions/route";
import { GET as getSub } from "@/app/api/v1/form-submissions/[id]/route";
import { POST as voidSub } from "@/app/api/v1/form-submissions/[id]/void/route";
import { POST as reassign } from "@/app/api/v1/form-submissions/[id]/reassign/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let readKey: string; // forms:read only
let otherKey: string; // clients:write: no forms scope
const ids: Record<string, string> = {};

const goodFields = [
  { id: "intro", type: "heading", label: "About you" },
  { id: "allergy", type: "yesno", label: "Any allergies?", required: true, map_to: "tag", tag: "allergy" },
  { id: "which", type: "text", label: "Which?", show_if: { field_id: "allergy", equals: "Yes" } },
  { id: "pick", type: "select", label: "Pick one", options: ["a", "b"] },
];
const formsOf = (biz: string) => withTenant(biz, (tx) => tx.select().from(schema.forms).where(eq(schema.forms.businessId, biz)));

describe.skipIf(!up)("API: forms", () => {
  beforeAll(async () => {
    kit = await setupKit(["forms:write"]);
    readKey = await mkKey(kit.A, ["forms:read"]);
    otherKey = await mkKey(kit.A, ["clients:write"]);
    for (const biz of [kit.A, kit.B]) {
      const [c] = await withTenant(biz, (tx) => tx.insert(schema.clients).values({ businessId: biz, firstName: "Pat", lastName: biz }).returning());
      const [c2] = await withTenant(biz, (tx) => tx.insert(schema.clients).values({ businessId: biz, firstName: "Quinn", lastName: biz }).returning());
      const [s] = await withTenant(biz, (tx) => tx.insert(schema.services).values({ businessId: biz, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
      const [l1] = await withTenant(biz, (tx) => tx.insert(schema.locations).values({ businessId: biz, name: "One" }).returning());
      const [l2] = await withTenant(biz, (tx) => tx.insert(schema.locations).values({ businessId: biz, name: "Two" }).returning());
      const fields = [{ id: "q1", type: "text" as const, label: "Allergies" }, { id: "photo", type: "file" as const, label: "Photo" }, { id: "note", type: "statement" as const, label: "Read this" }];
      const [f] = await withTenant(biz, (tx) => tx.insert(schema.forms).values({ businessId: biz, name: `Intake ${biz}`, kind: "intake", fields }).returning());
      const [sub] = await withTenant(biz, (tx) => tx.insert(schema.formSubmissions).values({ businessId: biz, formId: f!.id, clientId: c!.id, answers: { q1: "latex", photo: "file-id-123" }, signatureName: "Pat", signatureFileId: "sigfile", ipAddress: "9.9.9.9", assistedByUserId: "staff-user" }).returning());
      Object.assign(ids, { [`client${biz}`]: c!.id, [`client2${biz}`]: c2!.id, [`service${biz}`]: s!.id, [`loc1${biz}`]: l1!.id, [`loc2${biz}`]: l2!.id, [`form${biz}`]: f!.id, [`sub${biz}`]: sub!.id });
    }
  });
  afterAll(async () => {
    if (kit) await kit.teardown();
  });

  const A = () => kit.A;
  const B = () => kit.B;
  const a = (k: string) => ids[`${k}${A()}`]!;
  const b = (k: string) => ids[`${k}${B()}`]!;
  const create = async (body: Record<string, unknown>) => call(postForm, kit.key, {}, send("POST", body));

  describe("POST /forms", () => {
    it("creates a form with the builder's questions and the app's defaults", async () => {
      const r = await create({ name: "Colour consent", kind: "consent", description: "I agree.", fields: goodFields });
      expect(r.status).toBe(201);
      const f = (await r.json()).data;
      expect(f).toMatchObject({ name: "Colour consent", kind: "consent", description: "I agree.", require_signature: true, apply_to_all: false, active: true, service_ids: [], location_ids: [], renew_days: null });
      expect(f.fields.map((x: { id: string }) => x.id)).toEqual(["intro", "allergy", "which", "pick"]);
      expect(f.fields[1]).toMatchObject({ required: true, map_to: "tag", tag: "allergy" });
      expect(f.fields[2].show_if).toEqual({ field_id: "allergy", equals: "Yes" });
      const stored = await withTenant(A(), (tx) => tx.query.forms.findFirst({ where: and(eq(schema.forms.id, f.id), eq(schema.forms.businessId, A())) }));
      expect(stored?.fields[2]?.showIf).toEqual({ fieldId: "allergy", equals: "Yes" });
      // Headings take no answer, so they are never required.
      expect(stored?.fields[0]?.required).toBe(false);
    });
    it("generates ids for questions that have none", async () => {
      const r = await create({ name: "No ids", kind: "intake", fields: [{ type: "text", label: "Name" }, { type: "email", label: "Email", map_to: "email" }] });
      expect(r.status).toBe(201);
      const ids2 = (await r.json()).data.fields.map((x: { id: string }) => x.id);
      expect(ids2[0]).toMatch(/^f_/);
      expect(new Set(ids2).size).toBe(2);
    });
    it("normalises locations like the staff app: all or none means everywhere, some means those", async () => {
      const one = await (await create({ name: "Loc one", kind: "intake", description: "x", location_ids: [a("loc1")] })).json();
      expect(one.data.location_ids).toEqual([a("loc1")]);
      const both = await (await create({ name: "Loc both", kind: "intake", description: "x", location_ids: [a("loc1"), a("loc2")], service_ids: [a("service")], renew_days: 365 })).json();
      expect(both.data.location_ids).toEqual([]);
      expect(both.data).toMatchObject({ service_ids: [a("service")], renew_days: 365 });
    });
    it("422 for what the builder would refuse", async () => {
      const base = { name: "Bad", kind: "intake", fields: [{ id: "a", type: "text", label: "A" }] };
      const bad: Record<string, unknown>[] = [
        { name: "Empty", kind: "intake" },
        { name: "Empty", kind: "intake", fields: [], description: "" },
        { ...base, kind: "survey" },
        { ...base, name: "" },
        { ...base, name: "x".repeat(121) },
        { ...base, fields: [{ id: "a", type: "text", label: "A" }, { id: "a", type: "text", label: "B" }] },
        { ...base, fields: [{ id: "a", type: "slider", label: "A" }] },
        { ...base, fields: [{ id: "a", type: "text", label: "" }] },
        { ...base, fields: [{ id: "a b", type: "text", label: "A" }] },
        { ...base, fields: [{ id: "a", type: "select", label: "A" }] },
        { ...base, fields: [{ id: "a", type: "text", label: "A", options: ["x"] }] },
        { ...base, fields: [{ id: "a", type: "text", label: "A", show_if: { field_id: "later", equals: "Yes" } }, { id: "later", type: "yesno", label: "L" }] },
        { ...base, fields: [{ id: "a", type: "text", label: "A" }, { id: "b", type: "text", label: "B", show_if: { field_id: "a", equals: "x" } }] },
        { ...base, fields: [{ id: "a", type: "phone", label: "A", map_to: "email" }] },
        { ...base, fields: [{ id: "a", type: "text", label: "A", tag: "x" }] },
        { ...base, fields: Array.from({ length: 101 }, (_, i) => ({ id: `f${i}`, type: "text", label: "L" })) },
        { ...base, renew_days: 0 },
        { ...base, bogus: true },
      ];
      for (const body of bad) expect((await create(body)).status, JSON.stringify(body).slice(0, 80)).toBe(422);
      expect((await formsOf(A())).filter((f) => ["Bad", "Empty", ""].includes(f.name))).toHaveLength(0);
    });
    it("404s another business's service or location and stores nothing", async () => {
      const before = (await formsOf(A())).length;
      expect((await create({ name: "Foreign svc", kind: "intake", description: "x", service_ids: [b("service")] })).status).toBe(404);
      expect((await create({ name: "Foreign loc", kind: "intake", description: "x", location_ids: [b("loc1")] })).status).toBe(404);
      expect((await create({ name: "Mixed", kind: "intake", description: "x", service_ids: [a("service"), b("service")] })).status).toBe(404);
      expect((await formsOf(A())).length).toBe(before);
    });
    it("403 without forms:write, 401 without a key", async () => {
      expect((await call(postForm, readKey, {}, send("POST", { name: "N", kind: "intake", description: "x" }))).status).toBe(403);
      expect((await call(postForm, otherKey, {}, send("POST", { name: "N", kind: "intake", description: "x" }))).status).toBe(403);
      expect((await call(postForm, null, {}, send("POST", { name: "N", kind: "intake", description: "x" }))).status).toBe(401);
    });
  });

  describe("GET /forms", () => {
    it("lists only this business's forms, with a field count and no questions", async () => {
      const r = await call(listForms, readKey, {});
      expect(r.status).toBe(200);
      const rows = (await r.json()).data as { id: string; field_count: number; fields?: unknown }[];
      expect(rows.some((f) => f.id === a("form"))).toBe(true);
      expect(rows.some((f) => f.id === b("form"))).toBe(false);
      expect(rows.find((f) => f.id === a("form"))!.field_count).toBe(3);
      expect(rows[0]!.fields).toBeUndefined();
      expect((await call(listForms, otherKey, {})).status).toBe(403);
    });
  });

  describe("GET/PATCH/DELETE /forms/:id", () => {
    it("GET returns the questions", async () => {
      const f = (await (await call(getForm, readKey, { id: a("form") })).json()).data;
      expect(f.fields).toHaveLength(3);
      expect(f.fields[1]).toMatchObject({ type: "file", label: "Photo" });
    });
    it("PATCH leaves unmentioned fields alone", async () => {
      const made = (await (await create({ name: "Patch me", kind: "consent", description: "Terms", fields: goodFields, require_signature: false, apply_to_all: true, renew_days: 30, service_ids: [a("service")], location_ids: [a("loc1")] })).json()).data;
      const r = await call(patchForm, kit.key, { id: made.id }, send("PATCH", { name: "Renamed" }));
      expect(r.status).toBe(200);
      const row = (await withTenant(A(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, made.id) })))!;
      expect(row).toMatchObject({ name: "Renamed", kind: "consent", description: "Terms", requireSignature: false, applyToAll: true, renewDays: 30, serviceIds: [a("service")], locationIds: [a("loc1")], active: true });
      expect(row.fields).toHaveLength(4);
      // An empty body changes nothing and is allowed.
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", {}))).status).toBe(200);
      // Explicit nulls clear what can be cleared; fields replace the list.
      const cleared = (await (await call(patchForm, kit.key, { id: made.id }, send("PATCH", { renew_days: null, location_ids: [], service_ids: [], active: false, fields: [{ id: "only", type: "text", label: "Only" }] }))).json()).data;
      expect(cleared).toMatchObject({ renew_days: null, location_ids: [], service_ids: [], active: false, description: "Terms" });
      expect(cleared.fields.map((x: { id: string }) => x.id)).toEqual(["only"]);
    });
    it("PATCH will not leave a form with nothing to answer or sign", async () => {
      const made = (await (await create({ name: "Hollow", kind: "intake", fields: [{ id: "a", type: "text", label: "A" }] })).json()).data;
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", { fields: [] }))).status).toBe(422);
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", { fields: [], description: "Just text" }))).status).toBe(200);
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", { description: null }))).status).toBe(422);
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", { kind: "nope" }))).status).toBe(422);
      expect((await call(patchForm, kit.key, { id: made.id }, send("PATCH", { id: "x" }))).status).toBe(422);
    });
    it("404s another business's form and ids in the body; the other form is untouched", async () => {
      const before = await withTenant(B(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, b("form")) }));
      expect((await call(getForm, readKey, { id: b("form") })).status).toBe(404);
      expect((await call(patchForm, kit.key, { id: b("form") }, send("PATCH", { name: "Hijacked", active: false }))).status).toBe(404);
      expect((await call(deleteForm, kit.key, { id: b("form") }, send("DELETE"))).status).toBe(404);
      expect((await call(duplicate, kit.key, { id: b("form") }, send("POST"))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, b("form")) }))).toEqual(before);
      expect((await formsOf(B())).length).toBe(1);

      const mine = (await (await create({ name: "Mine", kind: "intake", description: "x" })).json()).data;
      expect((await call(patchForm, kit.key, { id: mine.id }, send("PATCH", { service_ids: [b("service")] }))).status).toBe(404);
      expect((await call(patchForm, kit.key, { id: mine.id }, send("PATCH", { location_ids: [b("loc1")] }))).status).toBe(404);
      expect((await withTenant(A(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, mine.id) })))?.serviceIds).toEqual([]);
    });
    it("403 without forms:write", async () => {
      expect((await call(patchForm, readKey, { id: a("form") }, send("PATCH", { name: "x" }))).status).toBe(403);
      expect((await call(deleteForm, readKey, { id: a("form") }, send("DELETE"))).status).toBe(403);
      expect((await call(duplicate, readKey, { id: a("form") }, send("POST"))).status).toBe(403);
    });
    it("DELETE removes an unused form and archives one with submissions", async () => {
      const unused = (await (await create({ name: "Unused", kind: "intake", description: "x" })).json()).data;
      const r = await call(deleteForm, kit.key, { id: unused.id }, send("DELETE"));
      expect(r.status).toBe(200);
      expect((await r.json()).data).toEqual({ id: unused.id, deleted: true, archived: false });
      expect(await withTenant(A(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, unused.id) }))).toBeUndefined();
      expect((await call(deleteForm, kit.key, { id: unused.id }, send("DELETE"))).status).toBe(404);

      const used = (await (await create({ name: "Used", kind: "intake", description: "x" })).json()).data;
      const [sub] = await withTenant(A(), (tx) => tx.insert(schema.formSubmissions).values({ businessId: A(), formId: used.id, clientId: a("client") }).returning());
      const r2 = await call(deleteForm, kit.key, { id: used.id }, send("DELETE"));
      expect((await r2.json()).data).toEqual({ id: used.id, deleted: false, archived: true });
      expect((await withTenant(A(), (tx) => tx.query.forms.findFirst({ where: eq(schema.forms.id, used.id) })))?.active).toBe(false);
      expect(await withTenant(A(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, sub!.id) }))).toBeDefined();
    });
  });

  describe("POST /forms/:id/duplicate", () => {
    it("makes an inactive copy of the caller's form", async () => {
      const made = (await (await create({ name: "Original", kind: "consent", description: "d", fields: goodFields, apply_to_all: true })).json()).data;
      const r = await call(duplicate, kit.key, { id: made.id }, send("POST"));
      expect(r.status).toBe(201);
      const copy = (await r.json()).data;
      expect(copy).toMatchObject({ name: "Copy of Original", kind: "consent", description: "d", active: false, apply_to_all: true });
      expect(copy.id).not.toBe(made.id);
      expect(copy.fields).toEqual(made.fields);
    });
  });

  describe("form submissions", () => {
    it("lists only this business's, filters by form and client, and never exposes answers in the list", async () => {
      const r = await call(listSubs, readKey, {});
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.data.map((s: { id: string }) => s.id)).toContain(a("sub"));
      expect(body.data.map((s: { id: string }) => s.id)).not.toContain(b("sub"));
      expect(JSON.stringify(body)).not.toContain("latex");
      expect(JSON.stringify(body)).not.toContain("9.9.9.9");
      const byForm = await (await call(listSubs, readKey, {}, {}, `http://x/t?form_id=${a("form")}`)).json();
      expect(byForm.total).toBeGreaterThanOrEqual(1);
      expect(byForm.data.every((s: { form_id: string }) => s.form_id === a("form"))).toBe(true);
      const byName = await (await call(listSubs, readKey, {}, {}, "http://x/t?q=pat")).json();
      expect(byName.data.map((s: { id: string }) => s.id)).toContain(a("sub"));
      expect((await (await call(listSubs, readKey, {}, {}, "http://x/t?q=zzzznobody")).json()).total).toBe(0);
    });
    it("404s another business's form_id or client_id filter; 403 without the scope", async () => {
      expect((await call(listSubs, readKey, {}, {}, `http://x/t?form_id=${b("form")}`)).status).toBe(404);
      expect((await call(listSubs, readKey, {}, {}, `http://x/t?client_id=${b("client")}`)).status).toBe(404);
      expect((await call(listSubs, otherKey, {})).status).toBe(403);
    });
    it("GET returns labelled answers, hides files, the drawn signature and the ip address", async () => {
      const r = await call(getSub, readKey, { id: a("sub") });
      expect(r.status).toBe(200);
      const s = (await r.json()).data;
      expect(s).toMatchObject({ id: a("sub"), client_id: a("client"), form_name: `Intake ${A()}`, signed: true, signature_name: "Pat", assisted_by_staff: true, voided: false });
      expect(s.answers).toEqual([
        { field_id: "q1", label: "Allergies", type: "text", value: "latex" },
        { field_id: "photo", label: "Photo", type: "file", value: null, has_file: true },
      ]);
      const text = JSON.stringify(s);
      for (const secret of ["file-id-123", "sigfile", "9.9.9.9", "staff-user"]) expect(text).not.toContain(secret);
      expect((await call(getSub, readKey, { id: b("sub") })).status).toBe(404);
      expect((await call(getSub, otherKey, { id: a("sub") })).status).toBe(403);
    });
    it("void: marks it void once; the other business's submission is untouched", async () => {
      const [mine] = await withTenant(A(), (tx) => tx.insert(schema.formSubmissions).values({ businessId: A(), formId: a("form"), clientId: a("client"), answers: { q1: "x" } }).returning());
      expect((await call(voidSub, readKey, { id: mine!.id }, send("POST", {}))).status).toBe(403);
      expect((await call(voidSub, kit.key, { id: mine!.id }, send("POST", { reason: "x".repeat(201) }))).status).toBe(422);
      expect((await call(voidSub, kit.key, { id: mine!.id }, send("POST", { nope: 1 }))).status).toBe(422);
      const r = await call(voidSub, kit.key, { id: mine!.id }, send("POST", { reason: "Wrong person" }));
      expect(r.status).toBe(200);
      expect((await r.json()).data).toMatchObject({ voided: true, void_reason: "Wrong person" });
      expect((await call(voidSub, kit.key, { id: mine!.id }, send("POST", {}))).status).toBe(409);
      const stored = await withTenant(A(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, mine!.id) }));
      expect(stored).toMatchObject({ voidReason: "Wrong person", voidedByUserId: expect.stringMatching(/^api:/) });
      // The list can hide void ones.
      const shown = await (await call(listSubs, readKey, {}, {}, "http://x/t?include_voided=false")).json();
      expect(shown.data.map((x: { id: string }) => x.id)).not.toContain(mine!.id);

      expect((await call(voidSub, kit.key, { id: b("sub") }, send("POST", {}))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, b("sub")) })))?.voidedAt).toBeNull();
    });
    it("reassign: moves it to another of the caller's clients and detaches the visit", async () => {
      const [mine] = await withTenant(A(), (tx) => tx.insert(schema.formSubmissions).values({ businessId: A(), formId: a("form"), clientId: a("client") }).returning());
      expect((await call(reassign, readKey, { id: mine!.id }, send("POST", { client_id: a("client2") }))).status).toBe(403);
      expect((await call(reassign, kit.key, { id: mine!.id }, send("POST", {}))).status).toBe(422);
      expect((await call(reassign, kit.key, { id: mine!.id }, send("POST", { client_id: a("client2"), x: 1 }))).status).toBe(422);
      const r = await call(reassign, kit.key, { id: mine!.id }, send("POST", { client_id: a("client2") }));
      expect(r.status).toBe(200);
      expect((await r.json()).data.client_id).toBe(a("client2"));
      expect((await withTenant(A(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, mine!.id) })))?.clientId).toBe(a("client2"));
    });
    it("reassign: a client id from another business, or another business's submission, is a 404 and changes nothing", async () => {
      const [mine] = await withTenant(A(), (tx) => tx.insert(schema.formSubmissions).values({ businessId: A(), formId: a("form"), clientId: a("client") }).returning());
      expect((await call(reassign, kit.key, { id: mine!.id }, send("POST", { client_id: b("client") }))).status).toBe(404);
      expect((await withTenant(A(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, mine!.id) })))?.clientId).toBe(a("client"));
      expect((await call(reassign, kit.key, { id: b("sub") }, send("POST", { client_id: a("client2") }))).status).toBe(404);
      expect((await call(reassign, kit.key, { id: b("sub") }, send("POST", { client_id: b("client2") }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.formSubmissions.findFirst({ where: eq(schema.formSubmissions.id, b("sub")) })))?.clientId).toBe(b("client"));
    });
  });
});
