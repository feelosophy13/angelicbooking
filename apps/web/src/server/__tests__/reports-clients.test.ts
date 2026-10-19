/**
 * Reports: client cohorts for a range. New = first completed visit in the range; returning = a completed visit in the range and one
 * before it; churned = the business's "lapsed after" days passed since the last completed visit inside the range, with nothing booked
 * after it; retention's base is who visited in the equal-length range before. Needs Postgres at DATABASE_URL (the app role, RLS forced);
 * skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { clientCohorts } from "@/server/sales";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const DAY = 86_400_000;

describe.skipIf(!up)("reports: new, returning and churned clients", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  let locationId: string;
  let otherLocationId: string;
  // The range is the 30 days ending today (business-local); `to` is tomorrow 00:00, exclusive.
  let to: Date;
  let from: Date;
  const ids: Record<string, string> = {};
  let saleNo = 1;
  let slot = 0;
  let chloeLast: Date;

  const at = (daysBeforeEnd: number) => new Date(to.getTime() - daysBeforeEnd * DAY);
  const client = async (name: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) => {
    const [c] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: name, ...extra }).returning({ id: schema.clients.id }));
    ids[name] = c!.id;
    return c!.id;
  };
  // Each visit takes its own hour of Sam's day (the no-double-booking rule), so the starts drift by up to a day: never across a window edge here.
  const appointment = async (clientId: string, day: Date, status: "completed" | "booked" | "cancelled" | "no_show", opts: { kind?: string; location?: string | null } = {}) => {
    const start = new Date(day.getTime() + slot++ * 3_600_000);
    await withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId, status, kind: opts.kind ?? "visit", locationId: opts.location === undefined ? locationId : opts.location }).returning({ id: schema.appointments.id });
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceName: "Cut", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 5000, status });
    });
    return start;
  };
  const sale = (clientId: string, closedAt: Date, cents: number, tipCents = 0, location: string | null = locationId) =>
    withTenant(kit.A, (tx) => tx.insert(schema.sales).values({ businessId: kit.A, number: saleNo++, clientId, locationId: location, status: "paid", subtotalCents: cents, totalCents: cents + tipCents, tipCents, paidCents: cents + tipCents, closedAt }));

  beforeAll(async () => {
    kit = await setupKit([]);
    const business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    expect(business.lapsedAfterDays).toBe(90);
    const tz = business.timezone;
    to = zonedToInstant(shiftISODate(instantToISODate(new Date(), tz), 1), "00:00", tz);
    from = new Date(to.getTime() - 30 * DAY);
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [l] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning({ id: schema.locations.id });
      const [l2] = await tx.insert(schema.locations).values({ businessId: kit.A, name: "Annex" }).returning({ id: schema.locations.id });
      locationId = l!.id;
      otherLocationId = l2!.id;
    });
    // Nina: first visit ever inside the range (new). Her cancelled and no-show bookings do not make her a client earlier.
    const nina = await client("Nina", { phone: "+15551230001", email: "nina@example.test" });
    await appointment(nina, at(50), "cancelled");
    await appointment(nina, at(40), "no_show");
    await appointment(nina, at(5), "completed");
    await sale(nina, at(5), 10_000, 1_000);
    // Rae: visited in the previous 30 days and again in the range (returning). The earlier sale is outside the range.
    const rae = await client("Rae");
    await appointment(rae, at(45), "completed");
    await sale(rae, at(45), 5_000);
    await appointment(rae, at(10), "completed");
    await sale(rae, at(10), 8_000, 500);
    // Chloe: last visit 95 days before the range end, so her 90th day without a visit fell inside the range (churned). Her spend in the
    // year before that day is the two later sales; the one 400 days back is too old.
    const chloe = await client("Chloe", { phone: "+15551230002" });
    await appointment(chloe, at(400), "completed");
    await sale(chloe, at(400), 6_000);
    await appointment(chloe, at(300), "completed");
    await sale(chloe, at(300), 15_000);
    chloeLast = await appointment(chloe, at(95), "completed");
    await sale(chloe, at(95), 20_000, 2_000);
    // Dan: lapsed the same way but has a visit booked after the range, so he is not churned.
    const dan = await client("Dan");
    await appointment(dan, at(96), "completed");
    await appointment(dan, at(-3), "booked");
    // Hal: lapsed in the range, then came back after it (a historical range): not churned either.
    const hal = await client("Hal");
    await appointment(hal, at(97), "completed");
    await appointment(hal, at(-1), "completed");
    // Eve: her 90th day fell in the previous range, not this one.
    const eve = await client("Eve");
    await appointment(eve, at(140), "completed");
    await sale(eve, at(140), 4_000);
    // Fay: visited only in the previous range (active before, neither new nor returning now).
    const fay = await client("Fay");
    await appointment(fay, at(45), "completed");
    // Ivy: a class, not a visit, and a visit at the other location: neither counts for the Main location.
    const ivy = await client("Ivy");
    await appointment(ivy, at(7), "completed", { kind: "class" });
    await appointment(ivy, at(6), "completed", { location: otherLocationId });
    await sale(ivy, at(6), 3_000, 0, otherLocationId);
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("counts each cohort, its revenue and the churned list for the range", async () => {
    const c = await clientCohorts(kit.A, from, to, { lapsedDays: 90 });
    expect(c.fresh).toEqual({ count: 2, revenueCents: 13_000 }); // Nina $100 and Ivy $30 (every site); tips are not revenue
    expect(c.returning).toEqual({ count: 1, revenueCents: 8_000 });
    expect(c.churned.count).toBe(1);
    expect(c.churned.revenueCents).toBe(35_000);
    expect(c.churned.top.map((t) => ({ name: t.firstName, visits: t.visits, spend: t.spendCents, phone: t.phone, lastVisit: t.lastVisit.getTime() }))).toEqual([{ name: "Chloe", visits: 3, spend: 35_000, phone: "+15551230002", lastVisit: chloeLast.getTime() }]);
    expect(c.activeBefore).toBe(2); // Rae and Fay visited in the 30 days before
    expect(c.lapsedDays).toBe(90);
  });

  it("gives the previous range its own cohorts, so the page can compare", async () => {
    const prev = await clientCohorts(kit.A, new Date(from.getTime() - 30 * DAY), from, { lapsedDays: 90 });
    expect(prev.fresh).toEqual({ count: 2, revenueCents: 5_000 }); // Rae (her $50) and Fay
    expect(prev.returning).toEqual({ count: 0, revenueCents: 0 });
    expect(prev.churned.count).toBe(1); // Eve, 90 days after her only visit
    expect(prev.churned.top[0]?.firstName).toBe("Eve");
    expect(prev.churned.revenueCents).toBe(4_000);
    expect(prev.activeBefore).toBe(0);
  });

  it("follows the location filter for visits and sales", async () => {
    const main = await clientCohorts(kit.A, from, to, { lapsedDays: 90, locationId });
    expect(main.fresh).toEqual({ count: 1, revenueCents: 10_000 }); // Ivy's visit was at the Annex
    expect(main.churned.count).toBe(1);
    const annex = await clientCohorts(kit.A, from, to, { lapsedDays: 90, locationId: otherLocationId });
    expect(annex.fresh).toEqual({ count: 1, revenueCents: 3_000 });
    expect(annex.returning.count).toBe(0);
    expect(annex.churned.count).toBe(0);
  });

  it("moves the churned line with the lapsed-after setting and lists everyone without a limit", async () => {
    // At 60 days Chloe's line fell 35 days before the end (before the range) and Fay's falls after it: nobody. At 120 days it is Eve
    // (her only visit was 140 days back); Chloe's 120th day is still ahead. Dan (booked ahead) and Hal (came back) never count.
    const sixty = await clientCohorts(kit.A, from, to, { lapsedDays: 60, limit: null });
    expect(sixty.churned.count).toBe(0);
    const long = await clientCohorts(kit.A, from, to, { lapsedDays: 120 });
    expect(long.churned.top.map((t) => t.firstName)).toEqual(["Eve"]);
    // A wider range picks up Eve too, ordered by past spend.
    const wide = await clientCohorts(kit.A, new Date(from.getTime() - 30 * DAY), to, { lapsedDays: 90, limit: null });
    expect(wide.churned.top.map((t) => t.firstName)).toEqual(["Chloe", "Eve"]);
    expect(wide.churned.count).toBe(2);
  });

  it("is invisible to another business", async () => {
    const other = await clientCohorts(kit.B, from, to, { lapsedDays: 90 });
    expect([other.fresh.count, other.returning.count, other.churned.count, other.activeBefore]).toEqual([0, 0, 0, 0]);
  });
});
