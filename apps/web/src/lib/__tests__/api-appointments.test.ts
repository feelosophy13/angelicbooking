/**
 * Integration test: appointment extras of the public API (services on a visit, standing appointments, classes, blocked time, waitlist).
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Every call that could message a client passes notify:false, and
 * the throwaway businesses have no messaging configured, so nothing is ever sent.
 */
import "../../../../../packages/db/src/env"; // must come first: @angelic/db connects when imported, so DATABASE_URL has to be loaded already
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { call, mkKey, reachable, send, setupKit } from "./api-test-kit";

import { POST as postAppt } from "@/app/api/v1/appointments/route";
import { GET as getAppt } from "@/app/api/v1/appointments/[id]/route";
import { POST as addService } from "@/app/api/v1/appointments/[id]/services/route";
import { DELETE as removeItem } from "@/app/api/v1/appointments/[id]/items/[itemId]/route";
import { POST as moveItem } from "@/app/api/v1/appointments/[id]/items/[itemId]/move/route";
import { POST as cancelSeries } from "@/app/api/v1/appointments/[id]/cancel-series/route";
import { POST as postSeries } from "@/app/api/v1/series/route";
import { GET as getSeries } from "@/app/api/v1/series/[id]/route";
import { GET as getClasses, POST as postClass } from "@/app/api/v1/classes/route";
import { GET as getClass } from "@/app/api/v1/classes/[id]/route";
import { POST as enrol } from "@/app/api/v1/classes/[id]/enrollments/route";
import { POST as cancelClass } from "@/app/api/v1/classes/[id]/cancel/route";
import { POST as postBlock } from "@/app/api/v1/blocks/route";
import { DELETE as deleteBlock } from "@/app/api/v1/blocks/[id]/route";
import { GET as getWaitlist, POST as postWaitlist } from "@/app/api/v1/waitlist/route";
import { PATCH as patchWaitlist } from "@/app/api/v1/waitlist/[id]/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let readKey: string; // appointments:read only
let otherKey: string; // a scope that is not appointments:*
let tz = "America/New_York";
const ids: Record<string, string> = {};

/** A start time `days` ahead at hh:00 salon time (all test staff work 09:00-17:00 every day). */
const slot = (days: number, hh: number, min = 0) => zonedToInstant(instantToISODate(new Date(Date.now() + days * 86_400_000), tz), `${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}`, tz);

async function mkStaff(biz: string, name = "Stylist") {
  const [st] = await withTenant(biz, (tx) => tx.insert(schema.staff).values({ businessId: biz, displayName: name }).returning());
  for (let weekday = 0; weekday < 7; weekday++) await withTenant(biz, (tx) => tx.insert(schema.staffSchedules).values({ businessId: biz, staffId: st!.id, weekday, startTime: "09:00", endTime: "17:00" }));
  return st!.id;
}
const mkClient = async (biz: string, name = "Pat") => (await withTenant(biz, (tx) => tx.insert(schema.clients).values({ businessId: biz, firstName: name }).returning()))[0]!.id;
const mkService = async (biz: string, over: Partial<typeof schema.services.$inferInsert> = {}) => (await withTenant(biz, (tx) => tx.insert(schema.services).values({ businessId: biz, name: "Cut", durationMin: 30, priceCents: 5000, ...over }).returning()))[0]!.id;

/** Book through the API (the existing endpoint) and return the appointment as the API shows it. */
async function book(clientId: string, serviceId: string, staffId: string, start: Date) {
  const r = await call(postAppt, kit.key, {}, send("POST", { client_id: clientId, service_id: serviceId, staff_id: staffId, start_at: start.toISOString(), notify: false }));
  expect(r.status).toBe(201);
  return (await r.json()).data as { id: string; status: string; items: { id: string; start_at: string; staff_id: string; status: string }[] };
}
let foreignDay = 100;
/** An appointment (with one item) in business B at a time nobody else uses, for "another business's id" checks. */
async function foreignVisit() {
  const day = foreignDay++;
  const [appt] = await withTenant(kit.B, (tx) => tx.insert(schema.appointments).values({ businessId: kit.B, clientId: ids[`client${kit.B}`]! }).returning());
  const [item] = await withTenant(kit.B, (tx) => tx.insert(schema.appointmentItems).values({ businessId: kit.B, appointmentId: appt!.id, staffId: ids[`staff${kit.B}`]!, serviceId: ids[`service${kit.B}`]!, serviceName: "Cut", startAt: slot(day, 10), endAt: slot(day, 11), priceCents: 1 }).returning());
  return { appt: appt!, item: item!, startAt: slot(day, 10) };
}
const rowsOf = (biz: string, apptId: string) => withTenant(biz, (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, apptId)));

describe.skipIf(!up)("API: appointment extras", () => {
  beforeAll(async () => {
    kit = await setupKit(["appointments:write", "clients:read"]);
    readKey = await mkKey(kit.A, ["appointments:read"]);
    otherKey = await mkKey(kit.A, ["catalog:read"]);
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A), columns: { timezone: true } }))!.timezone;
    for (const biz of [kit.A, kit.B]) {
      Object.assign(ids, { [`client${biz}`]: await mkClient(biz), [`service${biz}`]: await mkService(biz), [`service2${biz}`]: await mkService(biz, { name: "Style" }), [`staff${biz}`]: await mkStaff(biz) });
    }
  });
  afterAll(async () => {
    if (kit) await kit.teardown();
  });

  const A = () => kit.A;
  const B = () => kit.B;
  const a = (k: string) => ids[`${k}${A()}`]!;
  const b = (k: string) => ids[`${k}${B()}`]!;

  describe("POST /appointments/:id/services", () => {
    it("adds a service to the caller's visit", async () => {
      const staff = await mkStaff(A());
      const start = slot(10, 10);
      const appt = await book(a("client"), a("service"), staff, start);
      const r = await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: new Date(start.getTime() + 1_800_000).toISOString() }));
      expect(r.status).toBe(201);
      const data = (await r.json()).data;
      expect(data.items).toHaveLength(2);
      expect(data.items.map((i: { service_id: string }) => i.service_id).sort()).toEqual([a("service"), a("service2")].sort());
      expect(await rowsOf(A(), appt.id)).toHaveLength(2);
    });
    it("409s when the time is taken", async () => {
      const staff = await mkStaff(A());
      const start = slot(10, 12);
      const appt = await book(a("client"), a("service"), staff, start);
      const r = await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: new Date(start.getTime() + 600_000).toISOString() }));
      expect(r.status).toBe(409);
      expect(await rowsOf(A(), appt.id)).toHaveLength(1);
    });
    it("404s foreign service or staff in the body, and another business's appointment", async () => {
      const staff = await mkStaff(A());
      const start = slot(10, 14);
      const appt = await book(a("client"), a("service"), staff, start);
      const when = new Date(start.getTime() + 1_800_000).toISOString();
      expect((await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: b("service"), staff_id: staff, start_at: when }))).status).toBe(404);
      expect((await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: b("staff"), start_at: when }))).status).toBe(404);
      expect(await rowsOf(A(), appt.id)).toHaveLength(1);

      // Another business's appointment, created directly in B.
      const { appt: bAppt } = await foreignVisit();
      expect((await call(addService, kit.key, { id: bAppt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: when }))).status).toBe(404);
      expect(await rowsOf(B(), bAppt.id)).toHaveLength(1);
    });
    it("403 without the scope, 422 for a bad body", async () => {
      const p = { id: "whatever" };
      const ok = { service_id: a("service2"), staff_id: a("staff"), start_at: slot(10, 15).toISOString() };
      expect((await call(addService, readKey, p, send("POST", ok))).status).toBe(403);
      expect((await call(addService, otherKey, p, send("POST", ok))).status).toBe(403);
      expect((await call(addService, kit.key, p, send("POST", { ...ok, service_id: undefined }))).status).toBe(422);
      expect((await call(addService, kit.key, p, send("POST", { ...ok, start_at: "2030-01-01T10:00:00" }))).status).toBe(422);
      expect((await call(addService, kit.key, p, send("POST", { ...ok, extra: 1 }))).status).toBe(422);
    });
    it("refuses to change a cancelled visit", async () => {
      const staff = await mkStaff(A());
      const start = slot(10, 16);
      const appt = await book(a("client"), a("service"), staff, start);
      await withTenant(A(), (tx) => tx.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.id, appt.id)));
      const r = await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: new Date(start.getTime() + 1_800_000).toISOString() }));
      expect(r.status).toBe(409);
    });
  });

  describe("POST /appointments/:id/items/:itemId/move", () => {
    it("moves one service, keeps the others, and optionally changes provider", async () => {
      const staff = await mkStaff(A());
      const staff2 = await mkStaff(A(), "Second");
      const start = slot(12, 10);
      const appt = await book(a("client"), a("service"), staff, start);
      await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: new Date(start.getTime() + 1_800_000).toISOString() }));
      const items = (await rowsOf(A(), appt.id)).sort((x, y) => x.sortOrder - y.sortOrder);
      const target = items[1]!;
      const moved = new Date(start.getTime() + 3 * 3_600_000);
      const r = await call(moveItem, kit.key, { id: appt.id, itemId: target.id }, send("POST", { start_at: moved.toISOString(), staff_id: staff2, notify: false }));
      expect(r.status).toBe(200);
      const after = await rowsOf(A(), appt.id);
      expect(after.find((i) => i.id === target.id)).toMatchObject({ staffId: staff2, startAt: moved });
      expect(after.find((i) => i.id === items[0]!.id)).toMatchObject({ staffId: staff, startAt: start });
    });
    it("409s outside the provider's hours", async () => {
      const staff = await mkStaff(A());
      const appt = await book(a("client"), a("service"), staff, slot(12, 13));
      const r = await call(moveItem, kit.key, { id: appt.id, itemId: appt.items[0]!.id }, send("POST", { start_at: slot(12, 22).toISOString(), notify: false }));
      expect(r.status).toBe(409);
    });
    it("404s a foreign staff id, another business's item, and an item that belongs to a different visit", async () => {
      const staff = await mkStaff(A());
      const one = await book(a("client"), a("service"), staff, slot(12, 15));
      const two = await book(a("client"), a("service"), staff, slot(13, 15));
      const itemOne = one.items[0]!.id;
      const when = slot(12, 16).toISOString();
      expect((await call(moveItem, kit.key, { id: one.id, itemId: itemOne }, send("POST", { start_at: when, staff_id: b("staff"), notify: false }))).status).toBe(404);
      expect((await call(moveItem, kit.key, { id: two.id, itemId: itemOne }, send("POST", { start_at: when, notify: false }))).status).toBe(404);
      const { appt: bAppt, item: bItem, startAt: bStart } = await foreignVisit();
      expect((await call(moveItem, kit.key, { id: bAppt.id, itemId: bItem.id }, send("POST", { start_at: when, notify: false }))).status).toBe(404);
      expect((await call(moveItem, kit.key, { id: one.id, itemId: bItem.id }, send("POST", { start_at: when, notify: false }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, bItem.id) })))?.startAt).toEqual(bStart);
      expect((await rowsOf(A(), one.id))[0]!.startAt).toEqual(slot(12, 15));
    });
    it("403 without the scope, 422 for a bad body", async () => {
      const p = { id: "x", itemId: "y" };
      expect((await call(moveItem, readKey, p, send("POST", { start_at: slot(12, 9).toISOString() }))).status).toBe(403);
      expect((await call(moveItem, kit.key, p, send("POST", {}))).status).toBe(422);
      expect((await call(moveItem, kit.key, p, send("POST", { start_at: "tomorrow" }))).status).toBe(422);
      expect((await call(moveItem, kit.key, p, send("POST", { start_at: slot(12, 9).toISOString(), what: 1 }))).status).toBe(422);
    });
  });

  describe("DELETE /appointments/:id/items/:itemId", () => {
    it("removes one service, then cancels the visit when the last one goes", async () => {
      const staff = await mkStaff(A());
      const start = slot(14, 10);
      const appt = await book(a("client"), a("service"), staff, start);
      await call(addService, kit.key, { id: appt.id }, send("POST", { service_id: a("service2"), staff_id: staff, start_at: new Date(start.getTime() + 1_800_000).toISOString() }));
      const items = (await rowsOf(A(), appt.id)).sort((x, y) => x.sortOrder - y.sortOrder);
      const quiet = "http://x/t?notify=false";
      const r1 = await call(removeItem, kit.key, { id: appt.id, itemId: items[1]!.id }, send("DELETE"), quiet);
      expect(r1.status).toBe(200);
      expect((await r1.json()).data.status).toBe("booked");
      expect((await call(removeItem, kit.key, { id: appt.id, itemId: items[1]!.id }, send("DELETE"), quiet)).status).toBe(409);
      const r2 = await call(removeItem, kit.key, { id: appt.id, itemId: items[0]!.id }, send("DELETE"), quiet);
      expect(r2.status).toBe(200);
      expect((await r2.json()).data.status).toBe("cancelled");
      expect((await call(removeItem, kit.key, { id: appt.id, itemId: items[0]!.id }, send("DELETE"), quiet)).status).toBe(409);
    });
    it("404s another business's item and an item addressed through the wrong visit; 403 without the scope", async () => {
      const staff = await mkStaff(A());
      const one = await book(a("client"), a("service"), staff, slot(14, 12));
      const two = await book(a("client"), a("service"), staff, slot(15, 12));
      const { appt: bAppt, item: bItem, startAt: bStart } = await foreignVisit();
      const quiet = "http://x/t?notify=false";
      expect((await call(removeItem, kit.key, { id: bAppt.id, itemId: bItem.id }, send("DELETE"), quiet)).status).toBe(404);
      expect((await call(removeItem, kit.key, { id: one.id, itemId: bItem.id }, send("DELETE"), quiet)).status).toBe(404);
      expect((await call(removeItem, kit.key, { id: two.id, itemId: one.items[0]!.id }, send("DELETE"), quiet)).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.id, bItem.id) })))?.status).toBe("booked");
      expect((await call(removeItem, readKey, { id: one.id, itemId: one.items[0]!.id }, send("DELETE"), quiet)).status).toBe(403);
    });
    it("will not touch a completed visit", async () => {
      const staff = await mkStaff(A());
      const appt = await book(a("client"), a("service"), staff, slot(14, 14));
      await withTenant(A(), (tx) => tx.update(schema.appointments).set({ status: "completed" }).where(eq(schema.appointments.id, appt.id)));
      expect((await call(removeItem, kit.key, { id: appt.id, itemId: appt.items[0]!.id }, send("DELETE"), "http://x/t?notify=false")).status).toBe(409);
    });
  });

  describe("notes on a visit (existing PATCH /appointments/:id)", () => {
    it("is unchanged: GET keeps its shape", async () => {
      const staff = await mkStaff(A());
      const appt = await book(a("client"), a("service"), staff, slot(16, 10));
      const r = await call(getAppt, readKey, { id: appt.id });
      expect(Object.keys((await r.json()).data).sort()).toEqual(["cancellation_reason", "cancellation_reason_id", "cancelled_at", "cancelled_by", "cancelled_late", "client_id", "created_at", "deposit_cents", "end_at", "id", "items", "kind", "location_id", "notes", "source", "start_at", "status"]);
    });
  });

  describe("standing appointments", () => {
    it("books a series, reads it back, and cancels the rest of it", async () => {
      const staff = await mkStaff(A());
      const first = slot(20, 10);
      const r = await call(postSeries, kit.key, {}, send("POST", { client_id: a("client"), service_id: a("service"), staff_id: staff, start_at: first.toISOString(), interval_weeks: 1, occurrences: 3, notes: "weekly", notify: false }));
      expect(r.status).toBe(201);
      const data = (await r.json()).data;
      expect(data).toMatchObject({ interval_weeks: 1, planned_occurrences: 3, notes: "weekly", client_id: a("client"), ended_at: null });
      expect(data.occurrences).toHaveLength(3);
      expect(data.skipped).toEqual([]);
      const got = await call(getSeries, readKey, { id: data.id });
      expect(got.status).toBe(200);
      expect((await got.json()).data.occurrences.map((o: { start_at: string }) => o.start_at)).toEqual(data.occurrences.map((o: { start_at: string }) => o.start_at));

      // Cancel from the second visit: the first stays booked.
      const second = data.occurrences[1].appointment_id;
      const c = await call(cancelSeries, kit.key, { id: second }, send("POST", { reason: "client moved", notify: false }));
      expect(c.status).toBe(200);
      expect((await c.json()).data.cancelled).toBe(2);
      const after = (await (await call(getSeries, readKey, { id: data.id })).json()).data;
      expect(after.occurrences.map((o: { status: string }) => o.status)).toEqual(["booked", "cancelled", "cancelled"]);
      expect(after.ended_at).not.toBeNull();
      // Asking again is harmless: nothing is left open to cancel.
      const again = await call(cancelSeries, kit.key, { id: second }, send("POST", { notify: false }));
      expect(again.status).toBe(200);
      expect((await again.json()).data.cancelled).toBe(0);
    });
    it("skips dates the provider cannot take and reports them; 409 when none work", async () => {
      const staff = await mkStaff(A());
      const first = slot(30, 10);
      // Block the second week's slot so only that date is skipped.
      const block = await call(postBlock, kit.key, {}, send("POST", { staff_id: staff, start_at: slot(37, 9).toISOString(), end_at: slot(37, 12).toISOString() }));
      expect(block.status).toBe(201);
      const r = await call(postSeries, kit.key, {}, send("POST", { client_id: a("client"), service_id: a("service"), staff_id: staff, start_at: first.toISOString(), interval_weeks: 1, occurrences: 3, notify: false }));
      expect(r.status).toBe(201);
      const data = (await r.json()).data;
      expect(data.occurrences).toHaveLength(2);
      expect(data.skipped).toHaveLength(1);
      // Outside working hours every date is skipped.
      const none = await call(postSeries, kit.key, {}, send("POST", { client_id: a("client"), service_id: a("service"), staff_id: staff, start_at: slot(40, 22).toISOString(), interval_weeks: 1, occurrences: 2, notify: false }));
      expect(none.status).toBe(409);
      expect(await withTenant(A(), (tx) => tx.select().from(schema.appointmentSeries).where(and(eq(schema.appointmentSeries.staffId, staff))))).toHaveLength(1);
    });
    it("404s foreign client, service, staff or location in the body and creates nothing", async () => {
      const staff = await mkStaff(A());
      const [bLoc] = await withTenant(B(), (tx) => tx.insert(schema.locations).values({ businessId: B(), name: "Elsewhere" }).returning());
      const ok = { client_id: a("client"), service_id: a("service"), staff_id: staff, start_at: slot(21, 10).toISOString(), interval_weeks: 2, occurrences: 2, notify: false };
      const before = (await withTenant(A(), (tx) => tx.select().from(schema.appointmentSeries))).length;
      for (const bad of [{ client_id: b("client") }, { service_id: b("service") }, { staff_id: b("staff") }, { location_id: bLoc!.id }]) {
        expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, ...bad }))).status).toBe(404);
      }
      expect((await withTenant(A(), (tx) => tx.select().from(schema.appointmentSeries))).length).toBe(before);
      expect((await withTenant(B(), (tx) => tx.select().from(schema.appointmentSeries))).length).toBe(0);
    });
    it("422 for a bad interval or count or unknown field; 403 without the scope", async () => {
      const ok = { client_id: a("client"), service_id: a("service"), staff_id: a("staff"), start_at: slot(21, 10).toISOString(), interval_weeks: 2, occurrences: 2 };
      expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, interval_weeks: 7 }))).status).toBe(422);
      expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, occurrences: 1 }))).status).toBe(422);
      expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, occurrences: 53 }))).status).toBe(422);
      expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, start_at: "2030-01-01" }))).status).toBe(422);
      expect((await call(postSeries, kit.key, {}, send("POST", { ...ok, wat: 1 }))).status).toBe(422);
      expect((await call(postSeries, readKey, {}, send("POST", ok))).status).toBe(403);
    });
    it("cannot read another business's series or cancel its visits; a plain visit is not a series", async () => {
      const [s] = await withTenant(B(), (tx) => tx.insert(schema.appointmentSeries).values({ businessId: B(), clientId: b("client"), serviceId: b("service"), staffId: b("staff"), intervalWeeks: 1, firstStartAt: slot(5, 10), occurrences: 2 }).returning());
      expect((await call(getSeries, readKey, { id: s!.id })).status).toBe(404);
      const [bAppt] = await withTenant(B(), (tx) => tx.insert(schema.appointments).values({ businessId: B(), clientId: b("client"), seriesId: s!.id }).returning());
      await withTenant(B(), (tx) => tx.insert(schema.appointmentItems).values({ businessId: B(), appointmentId: bAppt!.id, staffId: b("staff"), serviceId: b("service"), serviceName: "Cut", startAt: slot(5, 10), endAt: slot(5, 11), priceCents: 1 }));
      expect((await call(cancelSeries, kit.key, { id: bAppt!.id }, send("POST", { notify: false }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, bAppt!.id) })))?.status).toBe("booked");
      expect((await withTenant(B(), (tx) => tx.query.appointmentSeries.findFirst({ where: eq(schema.appointmentSeries.id, s!.id) })))?.endedAt).toBeNull();
      const staff = await mkStaff(A());
      const plain = await book(a("client"), a("service"), staff, slot(22, 10));
      expect((await call(cancelSeries, kit.key, { id: plain.id }, send("POST", { notify: false }))).status).toBe(409);
      expect((await call(cancelSeries, readKey, { id: plain.id }, send("POST", {}))).status).toBe(403);
      expect((await call(cancelSeries, kit.key, { id: plain.id }, send("POST", { reason: "x".repeat(501) }))).status).toBe(422);
    });
  });

  describe("classes", () => {
    it("schedules, lists, enrols, and cancels a class", async () => {
      const staff = await mkStaff(A());
      const svc = await mkService(A(), { name: "Yoga", capacity: 5 });
      const start = slot(25, 10);
      const created = await call(postClass, kit.key, {}, send("POST", { service_id: svc, staff_id: staff, start_at: start.toISOString(), notes: "bring a mat" }));
      expect(created.status).toBe(201);
      const cls = (await created.json()).data;
      expect(cls).toMatchObject({ service_id: svc, staff_id: staff, capacity: 5, booked: 0, seats_left: 5, status: "scheduled", notes: "bring a mat", service_name: "Yoga", roster: [] });

      const list = await (await call(getClasses, readKey, {}, {}, `http://x/t?service_id=${svc}`)).json();
      expect(list.data.map((c: { id: string }) => c.id)).toEqual([cls.id]);

      const client = await mkClient(A(), "Ana");
      const joined = await call(enrol, kit.key, { id: cls.id }, send("POST", { client_id: client, notify: false }));
      expect(joined.status).toBe(201);
      const jd = (await joined.json()).data;
      expect(jd.class).toMatchObject({ booked: 1, seats_left: 4 });
      expect(jd.class.roster[0]).toMatchObject({ appointment_id: jd.appointment_id, client_id: client, first_name: "Ana", status: "booked" });
      expect(Object.keys(jd.class.roster[0])).not.toContain("email");
      expect((await call(enrol, kit.key, { id: cls.id }, send("POST", { client_id: client, notify: false }))).status).toBe(409);

      const one = await call(getClass, readKey, { id: cls.id });
      expect((await one.json()).data.roster).toHaveLength(1);

      const cancelled = await call(cancelClass, kit.key, { id: cls.id }, send("POST", { reason: "teacher sick", notify: false }));
      expect(cancelled.status).toBe(200);
      const cd = (await cancelled.json()).data;
      expect(cd).toMatchObject({ status: "cancelled", cancelled_appointment_ids: [jd.appointment_id] });
      expect((await withTenant(A(), (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, jd.appointment_id) })))?.status).toBe("cancelled");
      expect((await call(cancelClass, kit.key, { id: cls.id }, send("POST", { notify: false }))).status).toBe(409);
      expect((await call(enrol, kit.key, { id: cls.id }, send("POST", { client_id: await mkClient(A()), notify: false }))).status).toBe(409);
    });
    it("409s when full, when the instructor is busy, and for a one-to-one service", async () => {
      const staff = await mkStaff(A());
      const svc = await mkService(A(), { name: "Pilates", capacity: 2 });
      const start = slot(26, 10);
      const made = await call(postClass, kit.key, {}, send("POST", { service_id: svc, staff_id: staff, start_at: start.toISOString(), capacity: 1 }));
      expect(made.status).toBe(201);
      const id = (await made.json()).data.id;
      expect((await call(enrol, kit.key, { id }, send("POST", { client_id: await mkClient(A()), notify: false }))).status).toBe(201);
      expect((await call(enrol, kit.key, { id }, send("POST", { client_id: await mkClient(A()), notify: false }))).status).toBe(409);
      expect((await call(postClass, kit.key, {}, send("POST", { service_id: svc, staff_id: staff, start_at: start.toISOString() }))).status).toBe(409);
      expect((await call(postClass, kit.key, {}, send("POST", { service_id: a("service"), staff_id: staff, start_at: slot(26, 13).toISOString() }))).status).toBe(409);
    });
    it("404s foreign service, staff, client and class ids and changes nothing there", async () => {
      const staff = await mkStaff(A());
      const svc = await mkService(A(), { name: "Barre", capacity: 4 });
      const start = slot(27, 10);
      const before = (await withTenant(A(), (tx) => tx.select().from(schema.classSessions))).length;
      expect((await call(postClass, kit.key, {}, send("POST", { service_id: b("service"), staff_id: staff, start_at: start.toISOString() }))).status).toBe(404);
      expect((await call(postClass, kit.key, {}, send("POST", { service_id: svc, staff_id: b("staff"), start_at: start.toISOString() }))).status).toBe(404);
      expect((await call(getClasses, readKey, {}, {}, `http://x/t?service_id=${b("service")}`)).status).toBe(404);
      expect((await withTenant(A(), (tx) => tx.select().from(schema.classSessions))).length).toBe(before);

      const bSvc = await mkService(B(), { name: "Barre", capacity: 4 });
      const [bClass] = await withTenant(B(), (tx) => tx.insert(schema.classSessions).values({ businessId: B(), serviceId: bSvc, staffId: b("staff"), startAt: slot(28, 10), endAt: slot(28, 11), capacity: 4, priceCents: 100 }).returning());
      expect((await call(getClass, readKey, { id: bClass!.id })).status).toBe(404);
      expect((await call(enrol, kit.key, { id: bClass!.id }, send("POST", { client_id: a("client"), notify: false }))).status).toBe(404);
      expect((await call(cancelClass, kit.key, { id: bClass!.id }, send("POST", { notify: false }))).status).toBe(404);
      const mine = await call(postClass, kit.key, {}, send("POST", { service_id: svc, staff_id: staff, start_at: start.toISOString() }));
      const mineId = (await mine.json()).data.id;
      expect((await call(enrol, kit.key, { id: mineId }, send("POST", { client_id: b("client"), notify: false }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.classSessions.findFirst({ where: eq(schema.classSessions.id, bClass!.id) })))?.status).toBe("scheduled");
      expect(await withTenant(B(), (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.classSessionId, bClass!.id)))).toHaveLength(0);
    });
    it("403 without the scope, 422 for bad bodies and windows", async () => {
      const ok = { service_id: a("service"), staff_id: a("staff"), start_at: slot(27, 10).toISOString() };
      expect((await call(postClass, readKey, {}, send("POST", ok))).status).toBe(403);
      expect((await call(getClasses, otherKey, {})).status).toBe(403);
      expect((await call(enrol, readKey, { id: "x" }, send("POST", { client_id: null }))).status).toBe(403);
      expect((await call(cancelClass, readKey, { id: "x" }, send("POST", {}))).status).toBe(403);
      expect((await call(postClass, kit.key, {}, send("POST", { ...ok, capacity: 0 }))).status).toBe(422);
      expect((await call(postClass, kit.key, {}, send("POST", { ...ok, start_at: "soon" }))).status).toBe(422);
      expect((await call(postClass, kit.key, {}, send("POST", { ...ok, extra: 1 }))).status).toBe(422);
      expect((await call(enrol, kit.key, { id: "x" }, send("POST", {}))).status).toBe(422);
      expect((await call(cancelClass, kit.key, { id: "x" }, send("POST", { reason: "x".repeat(201) }))).status).toBe(422);
      expect((await call(getClasses, readKey, {}, {}, "http://x/t?from=2030-01-01&to=2032-01-01")).status).toBe(422);
    });
  });

  describe("blocked time and waitlist (existing endpoints)", () => {
    it("blocks and unblocks only the caller's own calendar", async () => {
      const staff = await mkStaff(A());
      const made = await call(postBlock, kit.key, {}, send("POST", { staff_id: staff, start_at: slot(8, 12).toISOString(), end_at: slot(8, 13).toISOString(), reason: "Lunch" }));
      expect(made.status).toBe(201);
      const id = (await made.json()).data.id;
      expect((await call(postBlock, kit.key, {}, send("POST", { staff_id: b("staff"), start_at: slot(8, 12).toISOString(), end_at: slot(8, 13).toISOString() }))).status).toBe(404);
      const [bBlock] = await withTenant(B(), (tx) => tx.insert(schema.appointments).values({ businessId: B(), kind: "block" }).returning());
      expect((await call(deleteBlock, kit.key, { id: bBlock!.id }, send("DELETE"))).status).toBe(404);
      expect(await withTenant(B(), (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, bBlock!.id) }))).toBeDefined();
      expect((await call(deleteBlock, kit.key, { id }, send("DELETE"))).status).toBe(200);
      expect((await call(postBlock, readKey, {}, send("POST", { staff_id: staff, start_at: slot(8, 12).toISOString(), end_at: slot(8, 13).toISOString() }))).status).toBe(403);
    });
    it("waitlist: add, update, and never with another business's ids", async () => {
      const ok = { client_id: a("client"), service_id: a("service"), date: "2031-01-02" };
      const r = await call(postWaitlist, kit.key, {}, send("POST", ok));
      expect(r.status).toBe(201);
      const w = (await r.json()).data;
      expect((await call(postWaitlist, kit.key, {}, send("POST", { ...ok, client_id: b("client") }))).status).toBe(404);
      expect((await call(postWaitlist, kit.key, {}, send("POST", { ...ok, service_id: b("service") }))).status).toBe(404);
      expect((await call(postWaitlist, kit.key, {}, send("POST", { ...ok, staff_id: b("staff") }))).status).toBe(404);
      expect((await call(postWaitlist, kit.key, {}, send("POST", { ...ok, date: "01/02/2031" }))).status).toBe(422);
      expect((await call(postWaitlist, readKey, {}, send("POST", ok))).status).toBe(403);
      expect((await call(patchWaitlist, kit.key, { id: w.id }, send("PATCH", { status: "closed" }))).status).toBe(200);
      const [bw] = await withTenant(B(), (tx) => tx.insert(schema.waitlist).values({ businessId: B(), date: "2031-01-02" }).returning());
      expect((await call(patchWaitlist, kit.key, { id: bw!.id }, send("PATCH", { status: "closed" }))).status).toBe(404);
      expect((await withTenant(B(), (tx) => tx.query.waitlist.findFirst({ where: eq(schema.waitlist.id, bw!.id) })))?.status).toBe("open");
      const open = await (await call(getWaitlist, readKey, {}, {}, "http://x/t?status=open")).json();
      expect(open.data.find((x: { id: string }) => x.id === w.id)).toBeUndefined();
    });
  });
});
