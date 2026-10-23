/**
 * Integration test for the client check-in kiosk: what a phone lookup finds (today, this location, this business only) and shows
 * (first name and initial, never the number or last name), the early/late window, check-in through the shared status flow, forms
 * first, walk-ins onto the waitlist, unpairing and the rate limits. Needs Postgres at DATABASE_URL (the app role, RLS forced);
 * skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";
import { disableCheckin, enableCheckin, kioskAlerts, kioskCheckIn, kioskSubmitForm, kioskWalkIn, lookupCheckin, MISS_LIMIT, resetCheckin, resolveCheckin } from "@/server/checkin-kiosk";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const TZ = "America/New_York";

describe.skipIf(!up)("check-in kiosk", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let token: string;
  let otherToken: string;
  let mainId: string;
  const ids = {} as Record<"amy" | "amyVisit" | "bClient" | "bLoc" | "bStaff" | "far" | "farVisit" | "formy" | "formyVisit" | "jane" | "janeVisit" | "joe" | "joeVisit" | "ken" | "kenVisit" | "kim" | "kimVisit" | "lou" | "louVisit" | "other" | "staff", string>;
  // Noon today in the business's time zone, so the test means the same thing at any hour it runs.
  const today = instantToISODate(new Date(), TZ);
  const at = (hhmm: string) => zonedToInstant(today, hhmm, TZ);
  const noon = at("12:00");

  beforeAll(async () => {
    kit = await setupKit([]);
    await db.update(schema.businesses).set({ timezone: TZ, checkinEarlyMinutes: 60 }).where(eq(schema.businesses.id, kit.A));
    await db.update(schema.businesses).set({ timezone: TZ }).where(eq(schema.businesses.id, kit.B));
    const visit = async (biz: string, locationId: string, staffId: string, clientId: string, start: string, end: string, service = "Balayage") => {
      const [a] = await withTenant(biz, (tx) => tx.insert(schema.appointments).values({ businessId: biz, clientId, locationId }).returning({ id: schema.appointments.id }));
      await withTenant(biz, (tx) => tx.insert(schema.appointmentItems).values({ businessId: biz, appointmentId: a!.id, staffId, serviceName: service, startAt: at(start), endAt: at(end), priceCents: 9000, allowOverlap: true }));
      return a!.id;
    };
    await withTenant(kit.A, async (tx) => {
      const [main] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning({ id: schema.locations.id });
      const [other] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Uptown" }).returning({ id: schema.locations.id });
      mainId = main!.id;
      ids.other = other!.id;
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Maria Lopez" }).returning({ id: schema.staff.id });
      ids.staff = s!.id;
      const mk = async (firstName: string, lastName: string, phone: string) => (await tx.insert(schema.clients).values({ businessId: kit.A, firstName, lastName, phone }).returning({ id: schema.clients.id }))[0]!.id;
      ids.jane = await mk("Jane", "Smith", "+15551234567");
      ids.joe = await mk("Joe", "Brown", "+15559994567"); // same last four as Jane
      ids.amy = await mk("Amy", "Early", "+15550001111");
      ids.lou = await mk("Lou", "Late", "+15550002222");
      ids.kim = await mk("Kim", "Park", "+15550003333");
      ids.ken = await mk("Ken", "Park", "+15550003333"); // family sharing one number
      ids.far = await mk("Far", "Away", "+15550004444");
      ids.formy = await mk("Fay", "Forms", "+15550005555");
    });
    ids.janeVisit = await visit(kit.A, mainId, ids.staff, ids.jane, "12:30", "13:30");
    ids.joeVisit = await visit(kit.A, mainId, ids.staff, ids.joe, "12:15", "13:00");
    ids.amyVisit = await visit(kit.A, mainId, ids.staff, ids.amy, "15:00", "16:00");
    ids.louVisit = await visit(kit.A, mainId, ids.staff, ids.lou, "09:00", "10:00");
    ids.kimVisit = await visit(kit.A, mainId, ids.staff, ids.kim, "12:00", "13:00");
    ids.kenVisit = await visit(kit.A, mainId, ids.staff, ids.ken, "12:00", "12:45", "Kids cut");
    ids.farVisit = await visit(kit.A, ids.other, ids.staff, ids.far, "12:30", "13:30");
    ids.formyVisit = await visit(kit.A, mainId, ids.staff, ids.formy, "12:30", "13:30");
    await withTenant(kit.A, (tx) => tx.insert(schema.forms).values({ businessId: kit.A, name: "Color consent", applyToAll: true, requireSignature: true, fields: [{ id: "q1", type: "checkbox", label: "I agree", required: true }] as never }));
    // Another business with the same phone number today must never show up.
    await withTenant(kit.B, async (tx) => {
      const [l] = await tx.insert(schema.locations).values({ businessId: kit.B, name: "B main", isDefault: true }).returning({ id: schema.locations.id });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.B, displayName: "Bo" }).returning({ id: schema.staff.id });
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.B, firstName: "Other", lastName: "Biz", phone: "+15550004444" }).returning({ id: schema.clients.id });
      ids.bLoc = l!.id;
      ids.bStaff = s!.id;
      ids.bClient = c!.id;
    });
    await visit(kit.B, ids.bLoc, ids.bStaff, ids.bClient, "12:30", "13:30");
    token = await enableCheckin(kit.A, mainId);
    otherToken = await enableCheckin(kit.A, ids.other);
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("finds today's visit by the last four digits and shows only first name and initial", async () => {
    const r = await lookupCheckin(token, "0001111", noon).catch((e) => e);
    expect(r).toBeInstanceOf(Error); // 7 digits: neither last four nor a full number
    const amy = await lookupCheckin(token, "1111", noon);
    expect(amy.kind).toBe("found");
    if (amy.kind !== "found") return;
    expect(amy.people).toHaveLength(1);
    expect(amy.people[0]!.name).toBe("Amy E.");
    expect(amy.people[0]!.services).toEqual(["Balayage with Maria"]);
    const json = JSON.stringify(amy);
    expect(json).not.toContain("Early");
    expect(json).not.toContain("555");
    expect(json).not.toContain("9000");
  });

  it("asks for the full number when the last four fit more than one client, then finds the one", async () => {
    expect((await lookupCheckin(token, "4567", noon)).kind).toBe("need_full");
    const full = await lookupCheckin(token, "(555) 123-4567", noon);
    expect(full.kind === "found" && full.people.map((p) => p.name)).toEqual(["Jane S."]);
  });

  it("lists each person on a shared family number", async () => {
    const r = await lookupCheckin(token, "5550003333", noon);
    expect(r.kind === "found" && r.people.map((p) => p.name).sort()).toEqual(["Ken P.", "Kim P."]);
  });

  it("only sees this location and this business", async () => {
    expect((await lookupCheckin(token, "4444", noon)).kind).toBe("none");
    const there = await lookupCheckin(otherToken, "4444", noon);
    expect(there.kind === "found" && there.people.map((p) => p.name)).toEqual(["Far A."]);
    expect((await lookupCheckin(token, "9999", noon)).kind).toBe("none");
  });

  it("sends early and late arrivals to the desk", async () => {
    const early = await lookupCheckin(token, "1111", noon);
    expect(early.kind === "found" && early.people[0]!.state).toBe("early");
    await expect(kioskCheckIn(token, "1111", ids.amyVisit, {}, noon)).rejects.toThrow(/front desk/);
    const late = await lookupCheckin(token, "2222", noon);
    expect(late.kind === "found" && late.people[0]!.state).toBe("late");
    await expect(kioskCheckIn(token, "2222", ids.louVisit, {}, noon)).rejects.toThrow(/front desk/);
    // Inside the window it opens: Amy can check in from 2:00.
    const later = await lookupCheckin(token, "1111", at("14:05"));
    expect(later.kind === "found" && later.people[0]!.state).toBe("ready");
  });

  it("checks in through the shared status flow, once, and logs it as the client at the kiosk", async () => {
    // Jane's number matched, but her visit has the Color consent due: forms first, or the desk handles them.
    await expect(kioskCheckIn(token, "5551234567", ids.janeVisit, {}, noon)).rejects.toThrow(/forms/);
    const r = await kioskCheckIn(token, "5551234567", ids.janeVisit, { skipForms: true }, noon);
    expect(r).toMatchObject({ name: "Jane S.", already: false });
    const appt = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, ids.janeVisit) }));
    expect(appt!.status).toBe("checked_in");
    const log = await withTenant(kit.A, (tx) => tx.query.auditLog.findFirst({ where: and(eq(schema.auditLog.entityId, ids.janeVisit), eq(schema.auditLog.action, "appointment.checked_in")) }));
    expect(log!.actorUserId).toBe("client");
    expect((await kioskCheckIn(token, "5551234567", ids.janeVisit, {}, noon)).already).toBe(true);
    const alerts = await kioskAlerts({ id: kit.A, slug: kit.A, timezone: TZ }, new Date(Date.now() - 60_000));
    expect(alerts.some((a) => a.message.startsWith("Jane Smith checked in for 12:30") && a.href.endsWith(ids.janeVisit))).toBe(true);
  });

  it("refuses an appointment id the number doesn't match", async () => {
    await expect(kioskCheckIn(token, "1111", ids.kimVisit, { skipForms: true }, noon)).rejects.toThrow(/couldn't match/);
    await expect(kioskCheckIn(token, "4567", ids.joeVisit, { skipForms: true }, noon)).rejects.toThrow(/couldn't match/); // ambiguous four digits
    await expect(kioskCheckIn(otherToken, "5555", ids.formyVisit, { skipForms: true }, noon)).rejects.toThrow(/couldn't match/); // other site's kiosk
  });

  it("takes the visit's forms at the kiosk, then checks in", async () => {
    const r = await lookupCheckin(token, "5555", noon);
    if (r.kind !== "found") throw new Error("not found");
    const form = r.people[0]!.formsDue[0]!;
    expect(form.name).toBe("Color consent");
    const fd = new FormData();
    fd.set("a_q1", "on");
    fd.set("signatureName", "Fay Forms");
    await kioskSubmitForm(token, "5555", ids.formyVisit, form.id, fd, null, noon);
    const after = await lookupCheckin(token, "5555", noon);
    expect(after.kind === "found" && after.people[0]!.formsDue).toEqual([]);
    expect((await kioskCheckIn(token, "5555", ids.formyVisit, {}, noon)).already).toBe(false);
    await expect(kioskSubmitForm(token, "1111", ids.formyVisit, form.id, fd, null, noon)).rejects.toThrow(/couldn't match/);
  });

  it("puts a walk-in on today's waitlist without attaching them to a different person's record", async () => {
    const r = await kioskWalkIn(token, { firstName: "Tom", lastName: "Stranger", phone: "555-123-4567" }, noon);
    expect(r.firstName).toBe("Tom");
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.waitlist).where(eq(schema.waitlist.locationId, mainId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).not.toBe(ids.jane);
    expect(rows[0]!.notes).toMatch(/kiosk/);
    // Same person twice: still one entry.
    await kioskWalkIn(token, { firstName: "Tom", lastName: "Stranger", phone: "5551234567" }, noon);
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.waitlist).where(eq(schema.waitlist.locationId, mainId)))).toHaveLength(1);
    // An existing client with the same name and number is reused.
    await kioskWalkIn(token, { firstName: "jane", lastName: "smith", phone: "5551234567" }, noon);
    const all = await withTenant(kit.A, (tx) => tx.select().from(schema.waitlist).where(eq(schema.waitlist.locationId, mainId)));
    expect(all.some((w) => w.clientId === ids.jane)).toBe(true);
  });

  it("stops after too many numbers that match nobody", async () => {
    const t = await enableCheckin(kit.A, ids.other).then(() => resetCheckin(kit.A, ids.other));
    for (let i = 0; i < MISS_LIMIT; i++) expect((await lookupCheckin(t, "0000", noon)).kind).toBe("none");
    await expect(lookupCheckin(t, "0000", noon)).rejects.toThrow(/Too many tries/);
    await expect(lookupCheckin(t, "4444", noon)).rejects.toThrow(/Too many tries/);
  });

  it("unpairs: a new link or turning it off kills the old one", async () => {
    const fresh = await resetCheckin(kit.A, mainId);
    expect(fresh).not.toBe(token);
    expect(await resolveCheckin(token)).toBeNull();
    await expect(lookupCheckin(token, "1111", noon)).rejects.toThrow(/no longer set up/);
    expect(await resolveCheckin(fresh)).not.toBeNull();
    await disableCheckin(kit.A, mainId);
    expect(await resolveCheckin(fresh)).toBeNull();
  });
});
