/**
 * Integration test: the team area of /api/v1 (staff, hours, time off, services, pay, time clock, roles). Needs Postgres at DATABASE_URL (the app role,
 * RLS forced); skipped otherwise. Uses throwaway businesses from the shared kit, never a real tenant.
 */
import "../../../../../packages/db/src/env"; // first: @angelic/db connects when imported, and must see DATABASE_URL (the RLS-bound app role)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getSql, schema, withTenant } from "@angelic/db";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { call, reachable, send, setupKit } from "./api-test-kit";

import { GET as getTeam } from "@/app/api/v1/team/route";
import { GET as getTeamOne } from "@/app/api/v1/team/[id]/route";
import { POST as postStaff } from "@/app/api/v1/staff/route";
import { PATCH as patchStaff } from "@/app/api/v1/staff/[id]/route";
import { GET as getSchedule, PUT as putSchedule } from "@/app/api/v1/staff/[id]/schedule/route";
import { GET as getOverrides, POST as postOverride } from "@/app/api/v1/staff/[id]/overrides/route";
import { DELETE as deleteOverride } from "@/app/api/v1/staff/[id]/overrides/[overrideId]/route";
import { GET as getSvcs, PUT as putSvcs } from "@/app/api/v1/staff/[id]/services/route";
import { GET as getPay, PUT as putPay } from "@/app/api/v1/staff/[id]/pay/route";
import { GET as getEntries, POST as postEntry } from "@/app/api/v1/time-entries/route";
import { DELETE as deleteEntry } from "@/app/api/v1/time-entries/[id]/route";
import { GET as getRoles, POST as postRole } from "@/app/api/v1/roles/route";
import { GET as getPerms } from "@/app/api/v1/roles/permissions/route";
import { DELETE as deleteRole, GET as getRole, PATCH as patchRole } from "@/app/api/v1/roles/[id]/route";

const up = await reachable();
type Kit = Awaited<ReturnType<typeof setupKit>>;
let kit: Kit;
let key = "";
let catalogKey = "";
let noScope = "";
let readOnly = "";
let staffWriteOnly = "";
const id: Record<string, string> = {};
let extraUser: string | null = null;
// Role writes act as the key's creator: an owner for the main key, a manager for the escalation tests.
let ownerUser = "";
let managerUser = "";

const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });
const noParams = {} as Record<string, never>;

beforeAll(async () => {
  if (!up) return;
  kit = await setupKit(["staff:write", "pay:write", "roles:write"]);
  key = kit.key;
  ownerUser = `owner_${kit.A}`;
  managerUser = `manager_${kit.A}`;
  await db.insert(schema.user).values([{ id: ownerUser, name: "Owner", email: `${ownerUser}@example.com` }, { id: managerUser, name: "Manager", email: `${managerUser}@example.com` }]);
  await db.insert(schema.member).values([{ id: `mo_${kit.A}`, organizationId: kit.A, userId: ownerUser, role: "owner" }, { id: `mm_${kit.A}`, organizationId: kit.A, userId: managerUser, role: "manager" }]);
  noScope = await kit.mkKey(kit.A, ["clients:write", "catalog:write"]);
  readOnly = await kit.mkKey(kit.A, ["staff:read", "pay:read", "roles:read"]);
  staffWriteOnly = await kit.mkKey(kit.A, ["staff:write"]);
  for (const b of [kit.A, kit.B]) {
    const [loc] = await withTenant(b, (tx) => tx.insert(schema.locations).values({ businessId: b, name: `Loc ${b}`, isDefault: true }).returning());
    const [svc] = await withTenant(b, (tx) => tx.insert(schema.services).values({ businessId: b, name: "Cut", durationMin: 30, priceCents: 5000 }).returning());
    const [st] = await withTenant(b, (tx) => tx.insert(schema.staff).values({ businessId: b, displayName: `Staff ${b}`, fullName: `Full ${b}`, email: `s-${b}@example.com`, phone: "555", clockPinHash: "pinhash-secret", position: "Stylist", bio: "Bio" }).returning());
    const [ov] = await withTenant(b, (tx) => tx.insert(schema.staffScheduleOverrides).values({ businessId: b, staffId: st!.id, date: "2030-01-01", isOff: true }).returning());
    const [te] = await withTenant(b, (tx) => tx.insert(schema.timeEntries).values({ businessId: b, staffId: st!.id, date: "2030-01-01", minutes: 60 }).returning());
    await withTenant(b, (tx) => tx.insert(schema.staffSchedules).values({ businessId: b, staffId: st!.id, weekday: 1, startTime: "10:00", endTime: "12:00" }));
    const [role] = await withTenant(b, (tx) => tx.insert(schema.roles).values({ businessId: b, key: "custom_x", name: "Custom X", permissions: ["clients.read"], isSystem: false, sortOrder: 100 }).returning());
    const t = b === kit.A ? "A" : "B";
    Object.assign(id, { [`loc${t}`]: loc!.id, [`svc${t}`]: svc!.id, [`staff${t}`]: st!.id, [`ov${t}`]: ov!.id, [`te${t}`]: te!.id, [`role${t}`]: role!.id });
  }
});

// A key may make 120 requests a minute, and the suite makes more: each test gets its own.
beforeEach(async () => {
  if (!up) return;
  key = await kit.mkKey(kit.A, ["staff:write", "pay:write", "roles:write"], { createdBy: ownerUser });
  catalogKey = await kit.mkKey(kit.A, ["catalog:read"]);
});

afterAll(async () => {
  if (!up) return;
  await kit.teardown();
  if (extraUser) await db.delete(schema.user).where(eq(schema.user.id, extraUser));
  for (const u of [ownerUser, managerUser]) if (u) await db.delete(schema.user).where(eq(schema.user.id, u));
  await getSql().end();
});

const staffRow = (sid: string, b = kit.A) => withTenant(b, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, sid) }));

describe.skipIf(!up)("API team: scopes", () => {
  it("every write endpoint answers 403 to a key without the scope, and read endpoints to a key with none", async () => {
    const S = id.staffA!;
    const cases: [string, Promise<Response>][] = [
      ["POST /staff", call(postStaff, noScope, noParams, send("POST", { display_name: "X" }))],
      ["PATCH /staff/{id}", call(patchStaff, noScope, { id: S }, send("PATCH", {}))],
      ["PUT schedule", call(putSchedule, noScope, { id: S }, send("PUT", { weekly: [] }))],
      ["POST overrides", call(postOverride, noScope, { id: S }, send("POST", {}))],
      ["DELETE override", call(deleteOverride, noScope, { id: S, overrideId: id.ovA! }, send("DELETE"))],
      ["PUT services", call(putSvcs, noScope, { id: S }, send("PUT", { services: [] }))],
      ["PUT pay", call(putPay, noScope, { id: S }, send("PUT", {}))],
      ["POST time-entries", call(postEntry, noScope, noParams, send("POST", {}))],
      ["DELETE time-entry", call(deleteEntry, noScope, { id: id.teA! }, send("DELETE"))],
      ["POST roles", call(postRole, noScope, noParams, send("POST", {}))],
      ["PATCH role", call(patchRole, noScope, { id: id.roleA! }, send("PATCH", {}))],
      ["DELETE role", call(deleteRole, noScope, { id: id.roleA! }, send("DELETE"))],
      ["GET team", call(getTeam, noScope)],
      ["GET team/{id}", call(getTeamOne, noScope, { id: S })],
      ["GET pay", call(getPay, noScope, { id: S })],
      ["GET roles", call(getRoles, noScope)],
      ["GET permissions", call(getPerms, noScope)],
      ["GET time-entries", call(getEntries, noScope)],
      ["GET overrides", call(getOverrides, noScope, { id: S })],
      ["GET services", call(getSvcs, noScope, { id: S })],
    ];
    for (const [name, p] of cases) expect((await p).status, name).toBe(403);
    // A read-only key cannot write.
    expect((await call(postStaff, readOnly, noParams, send("POST", { display_name: "X" }))).status).toBe(403);
    expect((await call(putPay, readOnly, { id: S }, send("PUT", { pay_type: "commission" }))).status).toBe(403);
    expect((await call(postRole, readOnly, noParams, send("POST", { name: "Zed", permissions: ["clients.read"] }))).status).toBe(403);
    // Pay has its own scopes: staff:write alone neither reads nor writes pay.
    expect((await call(getPay, staffWriteOnly, { id: S })).status).toBe(403);
    expect((await call(putPay, staffWriteOnly, { id: S }, send("PUT", {}))).status).toBe(403);
    // And no key at all is 401.
    expect((await call(getTeam, null)).status).toBe(401);
  });
});

describe.skipIf(!up)("API team: staff", () => {
  it("lists the team with contact details, inactive included, and never secrets or other businesses", async () => {
    await withTenant(kit.A, (tx) => tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Inactive One", active: false }));
    const r = await json(await call(getTeam, key));
    expect(r.status).toBe(200);
    const names = r.body.data.map((s: any) => s.display_name);
    expect(names).toContain("Inactive One");
    expect(names).not.toContain(`Staff ${kit.B}`);
    const me = r.body.data.find((s: any) => s.id === id.staffA);
    expect(me).toMatchObject({ full_name: `Full ${kit.A}`, email: `s-${kit.A}@example.com`, phone: "555", position: "Stylist" });
    const raw = JSON.stringify(r.body);
    for (const bad of ["clock_pin", "pinhash-secret", "calendar_token", "user_id", "hourly_rate", "commission"]) expect(raw).not.toContain(bad);
    expect((await json(await call(getTeam, key, noParams, {}, "http://x/api/v1/team?active=false"))).body.data.every((s: any) => s.active === false)).toBe(true);
    const one = await json(await call(getTeamOne, key, { id: id.staffA! }));
    expect(one.body.data.id).toBe(id.staffA);
    expect((await call(getTeamOne, key, { id: id.staffB! })).status).toBe(404);
  });

  it("creates staff with the default hours; validates; rejects a foreign location", async () => {
    const r = await json(await call(postStaff, key, noParams, send("POST", { display_name: "Newbie", email: "NEW@Example.com", color: "#112233", bio: "Hi" })));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ display_name: "Newbie", email: "new@example.com", color: "#112233", bookable_online: true, takes_appointments: true, active: true });
    const sched = await withTenant(kit.A, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, r.body.data.id)));
    expect(sched).toHaveLength(5);
    expect(new Set(sched.map((s) => s.weekday))).toEqual(new Set([2, 3, 4, 5, 6]));
    const front = await json(await call(postStaff, key, noParams, send("POST", { display_name: "Desk", takes_appointments: false })));
    expect(front.body.data).toMatchObject({ takes_appointments: false, bookable_online: false });
    // Validation
    expect((await call(postStaff, key, noParams, send("POST", {}))).status).toBe(422);
    expect((await call(postStaff, key, noParams, send("POST", { display_name: "X", email: "nope" }))).status).toBe(422);
    expect((await call(postStaff, key, noParams, send("POST", { display_name: "X", color: "red" }))).status).toBe(422);
    expect((await call(postStaff, key, noParams, send("POST", { display_name: "X", clock_pin: "1234" }))).status).toBe(422);
    expect((await call(postStaff, key, noParams, send("POST", { display_name: "X", user_id: "u1" }))).status).toBe(422);
    // A location of another business is a 404 and nothing is created.
    const before = (await withTenant(kit.A, (tx) => tx.select().from(schema.staff).where(eq(schema.staff.businessId, kit.A)))).length;
    expect((await call(postStaff, key, noParams, send("POST", { display_name: "Ghost", location_id: id.locB }))).status).toBe(404);
    expect((await withTenant(kit.A, (tx) => tx.select().from(schema.staff).where(eq(schema.staff.businessId, kit.A)))).length).toBe(before);
  });

  it("patches only what is sent", async () => {
    const before = (await staffRow(id.staffA!))!;
    const r = await json(await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { phone: "999", location_id: id.locA })));
    expect(r.status).toBe(200);
    const after = (await staffRow(id.staffA!))!;
    expect(after.phone).toBe("999");
    expect(after.locationId).toBe(id.locA);
    for (const k of ["displayName", "fullName", "email", "color", "bio", "position", "bookableOnline", "takesAppointments", "active", "sortOrder", "clockPinHash", "calendarToken"] as const) expect(after[k], k).toEqual(before[k]);
    // Deactivate and sort; takes_appointments off forces bookable_online off.
    await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { active: false, sort_order: 7 }));
    expect(await staffRow(id.staffA!)).toMatchObject({ active: false, sortOrder: 7, bookableOnline: true });
    await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { active: true, takes_appointments: false }));
    expect(await staffRow(id.staffA!)).toMatchObject({ active: true, takesAppointments: false, bookableOnline: false });
    await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { takes_appointments: true, bookable_online: true }));
    expect(await staffRow(id.staffA!)).toMatchObject({ takesAppointments: true, bookableOnline: true });
    // Blank text clears, validation, unknown fields.
    await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { bio: "" }));
    expect((await staffRow(id.staffA!))!.bio).toBeNull();
    expect((await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { display_name: "" }))).status).toBe(422);
    expect((await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { calendar_token: "x" }))).status).toBe(422);
    expect((await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { sort_order: -1 }))).status).toBe(422);
  });

  it("answers 404 for another business's staff or location and leaves them untouched", async () => {
    const before = (await staffRow(id.staffB!, kit.B))!;
    expect((await call(patchStaff, key, { id: id.staffB! }, send("PATCH", { display_name: "Hacked", active: false }))).status).toBe(404);
    expect(await staffRow(id.staffB!, kit.B)).toEqual(before);
    const mine = (await staffRow(id.staffA!))!;
    expect((await call(patchStaff, key, { id: id.staffA! }, send("PATCH", { display_name: "Moved", location_id: id.locB }))).status).toBe(404);
    expect(await staffRow(id.staffA!)).toEqual(mine);
  });
});

describe.skipIf(!up)("API team: weekly hours", () => {
  it("replaces the weekly hours and rotation", async () => {
    const weekly = [
      { weekday: 1, start: "09:00", end: "12:00" },
      { weekday: 1, start: "13:00", end: "17:00" },
      { weekday: 3, start: "10:00", end: "18:00" },
    ];
    const r = await json(await call(putSchedule, key, { id: id.staffA! }, send("PUT", { weekly })));
    expect(r.status).toBe(200);
    expect(r.body.data.weekly).toHaveLength(3);
    expect(r.body.data.rotation_weeks).toBe(1);
    expect(r.body.data.rotation_anchor).toBeNull();
    // A person's hours read with staff:read (S5 in PERMISSIONS-PLAN-2026-10-18.md); the catalog scope no longer opens them.
    expect((await call(getSchedule, catalogKey, { id: id.staffA! })).status).toBe(403);
    const g = await json(await call(getSchedule, readOnly, { id: id.staffA! }));
    expect(g.body.data.weekly.map((w: any) => `${w.weekday} ${w.start}-${w.end}`)).toEqual(["1 09:00-12:00", "1 13:00-17:00", "3 10:00-18:00"]);
    // Two-week rotation: anchor is a Monday, week 2 rows are kept.
    const two = await json(await call(putSchedule, key, { id: id.staffA! }, send("PUT", { rotation_weeks: 2, this_week_is: 1, weekly: [{ weekday: 2, week_index: 0, start: "09:00", end: "10:00" }, { weekday: 2, week_index: 1, start: "11:00", end: "12:00" }] })));
    expect(two.body.data.rotation_weeks).toBe(2);
    expect(new Date(two.body.data.rotation_anchor + "T00:00:00Z").getUTCDay()).toBe(1);
    expect(two.body.data.weekly.map((w: any) => w.week_index)).toEqual([0, 1]);
    // Omitting the rotation keeps it (and its anchor); an empty list clears the hours.
    const keep = await json(await call(putSchedule, key, { id: id.staffA! }, send("PUT", { weekly: [{ weekday: 4, week_index: 1, start: "09:00", end: "10:00" }] })));
    expect(keep.body.data.rotation_weeks).toBe(2);
    expect(keep.body.data.rotation_anchor).toBe(two.body.data.rotation_anchor);
    const cleared = await json(await call(putSchedule, key, { id: id.staffA! }, send("PUT", { rotation_weeks: 1, weekly: [] })));
    expect(cleared.body.data.weekly).toEqual([]);
    expect(cleared.body.data.rotation_anchor).toBeNull();
  });

  it("rejects bad hours with 422 and keeps what was stored", async () => {
    await call(putSchedule, key, { id: id.staffA! }, send("PUT", { weekly: [{ weekday: 1, start: "09:00", end: "10:00" }] }));
    const bad: unknown[] = [
      { weekly: [{ weekday: 1, start: "10:00", end: "09:00" }] },
      { weekly: [{ weekday: 1, start: "09:00", end: "09:00" }] },
      { weekly: [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }] },
      { weekly: [{ weekday: 7, start: "09:00", end: "10:00" }] },
      { weekly: [{ weekday: 1, start: "9am", end: "10:00" }] },
      { weekly: [{ weekday: 1, week_index: 1, start: "09:00", end: "10:00" }] },
      { rotation_weeks: 5, weekly: [] },
      { rotation_weeks: 2, this_week_is: 2, weekly: [] },
      { weekly: Array.from({ length: 13 }, (_, i) => ({ weekday: 1, start: `${String(i).padStart(2, "0")}:00`, end: `${String(i).padStart(2, "0")}:30` })) },
      {},
      { weekly: [], extra: 1 },
    ];
    for (const b of bad) expect((await call(putSchedule, key, { id: id.staffA! }, send("PUT", b))).status, JSON.stringify(b).slice(0, 80)).toBe(422);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, id.staffA!)));
    expect(rows).toHaveLength(1);
  });

  it("404s for another business's staff or location and changes nothing", async () => {
    const before = await withTenant(kit.B, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, id.staffB!)));
    expect((await call(putSchedule, key, { id: id.staffB! }, send("PUT", { weekly: [] }))).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, id.staffB!)))).toEqual(before);
    const mine = await withTenant(kit.A, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, id.staffA!)));
    expect((await call(putSchedule, key, { id: id.staffA! }, send("PUT", { weekly: [{ weekday: 2, start: "09:00", end: "10:00", location_id: id.locB }] }))).status).toBe(404);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, id.staffA!)))).toEqual(mine);
  });
});

describe.skipIf(!up)("API team: days off and custom hours", () => {
  it("adds, lists and removes overrides", async () => {
    const r = await json(await call(postOverride, key, { id: id.staffA! }, send("POST", { date: "2031-03-10", to: "2031-03-12", kind: "off", note: "Holiday" })));
    expect(r.status).toBe(201);
    expect(r.body.data.map((o: any) => o.date)).toEqual(["2031-03-10", "2031-03-11", "2031-03-12"]);
    expect(r.body.data[0]).toMatchObject({ is_off: true, start: null, end: null, note: "Holiday" });
    // Same date again replaces; changed hours.
    const h = await json(await call(postOverride, key, { id: id.staffA! }, send("POST", { date: "2031-03-11", kind: "hours", start: "12:00", end: "16:00" })));
    expect(h.body.data[0]).toMatchObject({ is_off: false, start: "12:00", end: "16:00" });
    const list = await json(await call(getOverrides, key, { id: id.staffA! }, {}, "http://x/api/v1/t?from=2031-03-01&to=2031-03-31"));
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data.find((o: any) => o.date === "2031-03-11").is_off).toBe(false);
    const del = await call(deleteOverride, key, { id: id.staffA!, overrideId: r.body.data[0].id });
    expect(del.status).toBe(200);
    expect((await json(await call(getOverrides, key, { id: id.staffA! }, {}, "http://x/api/v1/t?from=2031-03-01&to=2031-03-31"))).body.data).toHaveLength(2);
    expect((await call(deleteOverride, key, { id: id.staffA!, overrideId: r.body.data[0].id })).status).toBe(404);
  });

  it("validates", async () => {
    const bad: unknown[] = [
      { date: "2031-02-31", kind: "off" },
      { date: "2031-03-10", to: "2031-03-01", kind: "off" },
      { date: "2031-03-10", to: "2033-03-01", kind: "off" },
      { date: "2031-03-10", kind: "hours" },
      { date: "2031-03-10", kind: "hours", start: "12:00", end: "11:00" },
      { date: "2031-03-10", kind: "off", start: "09:00", end: "10:00" },
      { date: "2031-03-10", kind: "sick" },
      { date: "2031-03-10", kind: "off", extra: true },
    ];
    for (const b of bad) expect((await call(postOverride, key, { id: id.staffA! }, send("POST", b))).status, JSON.stringify(b)).toBe(422);
  });

  it("404s across businesses and never deletes another business's entry", async () => {
    expect((await call(postOverride, key, { id: id.staffB! }, send("POST", { date: "2031-04-01", kind: "off" }))).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.staffScheduleOverrides).where(eq(schema.staffScheduleOverrides.staffId, id.staffB!)))).toHaveLength(1);
    expect((await call(getOverrides, key, { id: id.staffB! })).status).toBe(404);
    // B's override id under A's staff id, and B's staff id with B's override id: both 404, row stays.
    expect((await call(deleteOverride, key, { id: id.staffA!, overrideId: id.ovB! })).status).toBe(404);
    expect((await call(deleteOverride, key, { id: id.staffB!, overrideId: id.ovB! })).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.staffScheduleOverrides).where(eq(schema.staffScheduleOverrides.id, id.ovB!)))).toHaveLength(1);
  });
});

describe.skipIf(!up)("API team: services a person performs", () => {
  it("sets services with own price and length, keeps omitted values, and stores base values as null", async () => {
    const r = await json(await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [{ service_id: id.svcA, price_cents: 6500, duration_min: 45 }] })));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([{ service_id: id.svcA, price_cents: 6500, duration_min: 45 }]);
    // Omitting price/duration keeps the stored ones.
    const keep = await json(await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [{ service_id: id.svcA }] })));
    expect(keep.body.data).toEqual([{ service_id: id.svcA, price_cents: 6500, duration_min: 45 }]);
    // A value equal to the service's own is stored as null ("use the base"); explicit null clears.
    const base = await json(await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [{ service_id: id.svcA, price_cents: 5000, duration_min: null }] })));
    expect(base.body.data).toEqual([{ service_id: id.svcA, price_cents: null, duration_min: null }]);
    expect((await json(await call(getSvcs, key, { id: id.staffA! }))).body.data).toHaveLength(1);
    // An empty list means they perform none.
    expect((await json(await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [] })))).body.data).toEqual([]);
  });

  it("validates and rejects foreign ids with 404, changing nothing", async () => {
    await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [{ service_id: id.svcA, price_cents: 7000 }] }));
    const bad: unknown[] = [
      { services: [{ service_id: id.svcA, price_cents: -1 }] },
      { services: [{ service_id: id.svcA, duration_min: 2 }] },
      { services: [{ service_id: id.svcA, duration_min: 601 }] },
      { services: [{ service_id: id.svcA }, { service_id: id.svcA }] },
      { services: [{ service_id: id.svcA, extra: 1 }] },
      {},
    ];
    for (const b of bad) expect((await call(putSvcs, key, { id: id.staffA! }, send("PUT", b))).status, JSON.stringify(b)).toBe(422);
    // B's service inside the body.
    expect((await call(putSvcs, key, { id: id.staffA! }, send("PUT", { services: [{ service_id: id.svcA }, { service_id: id.svcB }] }))).status).toBe(404);
    expect((await json(await call(getSvcs, key, { id: id.staffA! }))).body.data).toEqual([{ service_id: id.svcA, price_cents: 7000, duration_min: null }]);
    // B's staff in the URL.
    expect((await call(putSvcs, key, { id: id.staffB! }, send("PUT", { services: [{ service_id: id.svcA }] }))).status).toBe(404);
    expect((await call(getSvcs, key, { id: id.staffB! })).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.businessId, kit.B)))).toHaveLength(0);
  });
});

describe.skipIf(!up)("API team: pay", () => {
  it("records pay changes, keeps omitted values, requires a rate for hourly and salary", async () => {
    const first = await json(await call(putPay, key, { id: id.staffA! }, send("PUT", { pay_type: "commission", main_commission_bps: 4000, product_commission_bps: 500, cc_tip_fee_bps: 300, position: "Senior Stylist", note: "Raise" })));
    expect(first.status).toBe(200);
    expect(first.body.data.current).toMatchObject({ pay_type: "commission", main_commission_bps: 4000, product_commission_bps: 500, cc_tip_fee_bps: 300 });
    expect(first.body.data.position).toBe("Senior Stylist");
    expect(first.body.data.history).toHaveLength(1);
    // The staff record mirrors the row in force today.
    expect(await staffRow(id.staffA!)).toMatchObject({ mainCommissionBps: 4000, position: "Senior Stylist" });
    // Changing one field keeps the others (a later effective date adds a history row).
    const second = await json(await call(putPay, key, { id: id.staffA! }, send("PUT", { main_commission_bps: 4500, effective_from: "2099-01-01" })));
    expect(second.body.data.history).toHaveLength(2);
    expect(second.body.data.history[1]).toMatchObject({ effective_from: "2099-01-01", main_commission_bps: 4500, product_commission_bps: 500, cc_tip_fee_bps: 300, pay_type: "commission" });
    expect(second.body.data.current.main_commission_bps).toBe(4000);
    expect((await json(await call(getPay, key, { id: id.staffA! }))).body.data.history).toHaveLength(2);
    // The audit row exists and the created-by user id is not exposed.
    expect(JSON.stringify(second.body)).not.toContain("created_by");
    // Hourly needs a rate; salary needs a salary.
    expect((await call(putPay, key, { id: id.staffA! }, send("PUT", { pay_type: "hourly", effective_from: "2098-01-01" }))).status).toBe(422);
    expect((await call(putPay, key, { id: id.staffA! }, send("PUT", { pay_type: "salary", effective_from: "2098-01-01" }))).status).toBe(422);
    const hourly = await json(await call(putPay, key, { id: id.staffA! }, send("PUT", { pay_type: "hourly", hourly_rate_cents: 2500, overtime_override: true, tax_deduction_bps: 1000, effective_from: "2098-01-01" })));
    expect(hourly.status).toBe(200);
    expect(hourly.body.data.history.find((h: any) => h.effective_from === "2098-01-01")).toMatchObject({ pay_type: "hourly", hourly_rate_cents: 2500, overtime_override: true, tax_deduction_bps: 1000, tax_deduction_cents: null });
    const audits = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.businessId, kit.A), eq(schema.auditLog.action, "staff.pay_change"))));
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.every((a) => a.actorUserId?.startsWith("api:"))).toBe(true);
  });

  it("validates", async () => {
    const bad: unknown[] = [
      { pay_type: "wages" },
      { main_commission_bps: 10_001 },
      { main_commission_bps: -1 },
      { main_commission_bps: 12.5 },
      { hourly_rate_cents: -5 },
      { effective_from: "yesterday" },
      { effective_from: "1999-01-01" },
      { tax_deduction_bps: 10_000 },
      { note: "x".repeat(201) },
      { clock_pin: "1234" },
    ];
    for (const b of bad) expect((await call(putPay, key, { id: id.staffA! }, send("PUT", b))).status, JSON.stringify(b)).toBe(422);
  });

  it("404s for another business's staff and writes nothing there", async () => {
    expect((await call(putPay, key, { id: id.staffB! }, send("PUT", { pay_type: "commission", main_commission_bps: 9000, position: "Hacked" }))).status).toBe(404);
    expect((await call(getPay, key, { id: id.staffB! })).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.staffPayRates).where(eq(schema.staffPayRates.businessId, kit.B)))).toHaveLength(0);
    expect(await staffRow(id.staffB!, kit.B)).toMatchObject({ position: "Stylist", mainCommissionBps: 0 });
  });
});

describe.skipIf(!up)("API team: time clock entries", () => {
  it("adds, lists with filters and deletes entries", async () => {
    const r = await json(await call(postEntry, key, noParams, send("POST", { staff_id: id.staffA, date: "2031-05-05", hours: 7.5, note: "Manual" })));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ staff_id: id.staffA, date: "2031-05-05", minutes: 450, hours: 7.5, note: "Manual", clock_in_at: null });
    expect(JSON.stringify(r.body)).not.toContain("created_by");
    const stored = await withTenant(kit.A, (tx) => tx.query.timeEntries.findFirst({ where: eq(schema.timeEntries.id, r.body.data.id) }));
    expect(stored!.createdByUserId).toMatch(/^api:/);
    const all = await json(await call(getEntries, key));
    expect(all.body.data.map((e: any) => e.id)).toContain(r.body.data.id);
    expect(all.body.data.map((e: any) => e.id)).not.toContain(id.teB);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    const filtered = await json(await call(getEntries, key, noParams, {}, `http://x/api/v1/t?staff_id=${id.staffA}&from=2031-05-01&to=2031-05-31`));
    expect(filtered.body.data).toHaveLength(1);
    expect((await call(getEntries, key, noParams, {}, "http://x/api/v1/t?from=bad")).status).toBe(422);
    expect((await call(deleteEntry, key, { id: r.body.data.id })).status).toBe(200);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, r.body.data.id)))).toHaveLength(0);
    expect((await call(deleteEntry, key, { id: r.body.data.id })).status).toBe(404);
  });

  it("validates", async () => {
    const ok = { staff_id: id.staffA, date: "2031-05-05", hours: 1 };
    const bad: unknown[] = [{}, { ...ok, hours: 0 }, { ...ok, hours: 24.5 }, { ...ok, hours: 0.1 }, { ...ok, date: "2031-13-01" }, { ...ok, note: "x".repeat(121) }, { ...ok, minutes: 5 }, { date: ok.date, hours: 1 }];
    for (const b of bad) expect((await call(postEntry, key, noParams, send("POST", b))).status, JSON.stringify(b)).toBe(422);
  });

  it("rejects another business's staff and entries with 404", async () => {
    const n = (await withTenant(kit.B, (tx) => tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.businessId, kit.B)))).length;
    expect((await call(postEntry, key, noParams, send("POST", { staff_id: id.staffB, date: "2031-05-05", hours: 2 }))).status).toBe(404);
    expect((await call(getEntries, key, noParams, {}, `http://x/api/v1/t?staff_id=${id.staffB}`)).status).toBe(404);
    expect((await call(deleteEntry, key, { id: id.teB! })).status).toBe(404);
    expect(await withTenant(kit.B, (tx) => tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.businessId, kit.B)))).toHaveLength(n);
  });
});

describe.skipIf(!up)("API team: roles", () => {
  it("lists the built-in roles, the permission catalogue and one role", async () => {
    const r = await json(await call(getRoles, key));
    expect(r.status).toBe(200);
    const keys = r.body.data.map((x: any) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["owner", "manager", "provider", "front_desk", "custom_x"]));
    expect(r.body.data.find((x: any) => x.key === "owner")).toMatchObject({ is_system: true, is_locked: true, member_count: 1 });
    expect(JSON.stringify(r.body)).not.toContain(`Custom X`.concat("B"));
    const perms = await json(await call(getPerms, key));
    expect(perms.body.data.groups.length).toBeGreaterThan(3);
    expect(perms.body.data.actions).toContain("staff.manage");
    const one = await json(await call(getRole, key, { id: id.roleA! }));
    expect(one.body.data).toMatchObject({ key: "custom_x", permissions: ["clients.read"], is_system: false });
    expect((await call(getRole, key, { id: id.roleB! })).status).toBe(404);
  });

  it("creates, patches and deletes a custom role", async () => {
    const c = await json(await call(postRole, key, noParams, send("POST", { name: "Senior Stylist", description: "Top", permissions: ["clients.read", "appointments.read.own"] })));
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ key: "senior_stylist", name: "Senior Stylist", is_system: false, member_count: 0 });
    // A second role with the same name gets a unique key.
    const dup = await json(await call(postRole, key, noParams, send("POST", { name: "Senior Stylist", permissions: ["clients.read"] })));
    expect(dup.body.data.key).toBe("senior_stylist_2");
    // Patch: omitted fields stay.
    const p = await json(await call(patchRole, key, { id: c.body.data.id }, send("PATCH", { permissions: ["clients.read", "clients.write"] })));
    expect(p.status).toBe(200);
    const stored = await withTenant(kit.A, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, c.body.data.id) }));
    expect(stored).toMatchObject({ name: "Senior Stylist", description: "Top", permissions: ["clients.read", "clients.write"] });
    await call(patchRole, key, { id: c.body.data.id }, send("PATCH", { description: null }));
    expect((await withTenant(kit.A, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, c.body.data.id) })))!.description).toBeNull();
    expect((await call(deleteRole, key, { id: c.body.data.id })).status).toBe(200);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.id, c.body.data.id)))).toHaveLength(0);
    expect((await call(deleteRole, key, { id: c.body.data.id })).status).toBe(404);
  });

  it("acts as the key's creator: a manager key cannot grant billing.manage or edit its own role", async () => {
    await call(getRoles, key); // seeds the built-ins
    const roles = await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.businessId, kit.A)));
    const manager = roles.find((r) => r.key === "manager")!;
    await withTenant(kit.A, (tx) => tx.update(schema.roles).set({ permissions: [...DEFAULT_ROLE_PERMISSIONS.manager] }).where(eq(schema.roles.id, manager.id)));
    const managerKey = await kit.mkKey(kit.A, ["roles:write"], { createdBy: managerUser });
    const custom = (await json(await call(postRole, key, noParams, send("POST", { name: "Within reach", permissions: ["clients.read"] })))).body.data;
    // Granting what the manager's own role lacks: refused on create and on patch, and the role is left as it was.
    expect((await json(await call(postRole, managerKey, noParams, send("POST", { name: "Billing helper", permissions: ["clients.read", "billing.manage"] })))).status).toBe(403);
    expect((await json(await call(patchRole, managerKey, { id: custom.id }, send("PATCH", { permissions: ["clients.read", "billing.manage"] })))).status).toBe(403);
    expect((await withTenant(kit.A, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, custom.id) })))!.permissions).toEqual(["clients.read"]);
    // Their own role: hands off, even for a permission they hold.
    expect((await json(await call(patchRole, managerKey, { id: manager.id }, send("PATCH", { permissions: ["clients.read"] })))).status).toBe(403);
    expect((await withTenant(kit.A, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, manager.id) })))!.permissions).toEqual([...DEFAULT_ROLE_PERMISSIONS.manager]);
    // Within what they hold: fine, and the audit row names the person and the key.
    expect((await json(await call(patchRole, managerKey, { id: custom.id }, send("PATCH", { permissions: ["clients.read", "clients.write"] })))).status).toBe(200);
    const audit = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "api.role.update"), eq(schema.auditLog.entityId, custom.id))));
    expect(audit.at(-1)).toMatchObject({ actorUserId: managerUser });
    expect(audit.at(-1)!.diff).toContain("viaKeyId");
    // Deleting a role wider than their own: refused.
    const [wide] = await withTenant(kit.A, (tx) => tx.insert(schema.roles).values({ businessId: kit.A, key: "wide_x", name: "Wide", permissions: ["billing.manage"], isSystem: false, sortOrder: 100 }).returning());
    expect((await call(deleteRole, managerKey, { id: wide!.id })).status).toBe(403);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.id, wide!.id)))).toHaveLength(1);
    // An owner's key may do all of it.
    expect((await call(patchRole, key, { id: custom.id }, send("PATCH", { permissions: ["clients.read", "billing.manage"] }))).status).toBe(200);
    expect((await call(deleteRole, key, { id: wide!.id })).status).toBe(200);
    expect((await call(deleteRole, key, { id: custom.id })).status).toBe(200);
  });

  it("refuses role writes from a key with no creator, or whose creator has left", async () => {
    const orphan = await kit.mkKey(kit.A, ["roles:write"]);
    expect((await json(await call(postRole, orphan, noParams, send("POST", { name: "Nobody", permissions: ["clients.read"] })))).status).toBe(403);
    const leaver = `leaver_${kit.A}`;
    await db.insert(schema.user).values({ id: leaver, name: "Leaver", email: `${leaver}@example.com` });
    await db.insert(schema.member).values({ id: `ml_${kit.A}`, organizationId: kit.A, userId: leaver, role: "owner" });
    const leaverKey = await kit.mkKey(kit.A, ["roles:write"], { createdBy: leaver });
    expect((await call(postRole, leaverKey, noParams, send("POST", { name: "Still here", permissions: ["clients.read"] }))).status).toBe(201);
    await db.delete(schema.member).where(eq(schema.member.id, `ml_${kit.A}`));
    expect((await json(await call(postRole, leaverKey, noParams, send("POST", { name: "Gone", permissions: ["clients.read"] })))).status).toBe(403);
    expect((await call(patchRole, leaverKey, { id: id.roleA! }, send("PATCH", { name: "Gone" }))).status).toBe(403);
    expect((await call(deleteRole, leaverKey, { id: id.roleA! })).status).toBe(403);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.name, "Gone")))).toHaveLength(0);
    await db.delete(schema.user).where(eq(schema.user.id, leaver));
  });

  it("keeps the app's guards: owner locked, built-in roles stay, a role in use stays", async () => {
    await call(getRoles, key); // seeds the built-ins
    const roles = await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.businessId, kit.A)));
    const owner = roles.find((r) => r.key === "owner")!;
    const manager = roles.find((r) => r.key === "manager")!;
    const ownerBefore = owner.permissions;
    expect((await call(patchRole, key, { id: owner.id }, send("PATCH", { permissions: ["clients.read"] }))).status).toBe(409);
    expect((await call(patchRole, key, { id: owner.id }, send("PATCH", { name: "Boss" }))).status).toBe(409);
    expect((await withTenant(kit.A, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, owner.id) })))!.permissions).toEqual(ownerBefore);
    expect((await call(deleteRole, key, { id: owner.id })).status).toBe(409);
    expect((await call(deleteRole, key, { id: manager.id })).status).toBe(409);
    // A built-in role's permissions may be edited, like in the app.
    expect((await call(patchRole, key, { id: manager.id }, send("PATCH", { permissions: ["clients.read"] }))).status).toBe(200);
    // In use: a login holds it.
    extraUser = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: extraUser, name: "Holder", email: `${extraUser}@example.com` });
    await db.insert(schema.member).values({ id: `m_${kit.A}`, organizationId: kit.A, userId: extraUser, role: "custom_x" });
    const used = await json(await call(deleteRole, key, { id: id.roleA! }));
    expect(used.status).toBe(409);
    expect(used.body.error.message).toContain("1 member");
    expect((await json(await call(getRole, key, { id: id.roleA! }))).body.data.member_count).toBe(1);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.id, id.roleA!)))).toHaveLength(1);
    // The response never names the login.
    expect(JSON.stringify(used.body)).not.toContain(extraUser);
  });

  it("validates, and rejects another business's role with 404", async () => {
    const bad: unknown[] = [
      {},
      { name: "A", permissions: ["clients.read"] },
      { name: "Fine", permissions: [] },
      { name: "Fine", permissions: ["clients.read", "clients.read"] },
      { name: "Fine", permissions: ["root.everything"] },
      { name: "Fine", permissions: ["clients.read"], is_system: true },
      { name: "Fine", permissions: ["clients.read"], key: "owner" },
      { name: "x".repeat(41), permissions: ["clients.read"] },
    ];
    for (const b of bad) expect((await call(postRole, key, noParams, send("POST", b))).status, JSON.stringify(b)).toBe(422);
    expect((await call(patchRole, key, { id: id.roleA! }, send("PATCH", { permissions: [] }))).status).toBe(422);
    const before = await withTenant(kit.B, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, id.roleB!) }));
    expect((await call(patchRole, key, { id: id.roleB! }, send("PATCH", { name: "Hacked", permissions: ["settings.business"] }))).status).toBe(404);
    expect((await call(deleteRole, key, { id: id.roleB! }))).toHaveProperty("status", 404);
    expect(await withTenant(kit.B, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, id.roleB!) }))).toEqual(before);
  });

  it("writes an audit row for each change", async () => {
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.businessId, kit.A))));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["api.staff.create", "api.staff.update", "api.staff.schedule.replace", "api.staff.override.add", "api.staff.override.delete", "api.staff.services.replace", "api.staff.pay.update", "api.time_entry.create", "api.time_entry.delete", "api.role.create", "api.role.update", "api.role.delete"]) expect(actions.has(a), a).toBe(true);
  });
});
