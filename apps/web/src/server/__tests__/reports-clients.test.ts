/**
 * Reports: client cohorts for a period. New = first completed visit in the period; returning = a completed visit in the period and one
 * before it; due back = the business's "lapsed after" clock since their last completed visit ran out inside the period; retained = came
 * back within that many days or had a visit booked ahead at the period end; lost = the rest. "Lapsed right now" is as of today and is
 * what the We miss you automation sees. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { clientCohorts, lapsedClients } from "@/server/sales";
import { noVisitReach } from "@/server/workflows";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();
const DAY = 86_400_000;

describe.skipIf(!up)("reports: new, returning, lost and lapsed clients", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  let staffId: string;
  let locationId: string;
  let otherLocationId: string;
  // The period is the 30 days ending today (business-local); `to` is tomorrow 00:00, exclusive.
  let to: Date;
  let from: Date;
  let saleNo = 1;
  let slot = 0;
  let chloeLast: Date;

  const at = (daysBeforeEnd: number) => new Date(to.getTime() - daysBeforeEnd * DAY);
  const client = async (name: string, extra: Partial<typeof schema.clients.$inferInsert> = {}) => {
    const [c] = await withTenant(kit.A, (tx) => tx.insert(schema.clients).values({ businessId: kit.A, firstName: name, ...extra }).returning({ id: schema.clients.id }));
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
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
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
    // Nina: first visit ever inside the period (new). Her cancelled and no-show bookings do not make her a client earlier.
    const nina = await client("Nina", { phone: "+15551230001", email: "nina@example.test" });
    await appointment(nina, at(50), "cancelled");
    await appointment(nina, at(40), "no_show");
    await appointment(nina, at(5), "completed");
    await sale(nina, at(5), 10_000, 1_000);
    // Rae: visited in the previous 30 days and again in the period (returning). The earlier sale is outside the period.
    const rae = await client("Rae");
    await appointment(rae, at(45), "completed");
    await sale(rae, at(45), 5_000);
    await appointment(rae, at(10), "completed");
    await sale(rae, at(10), 8_000, 500);
    // Pia: her 90-day clock since the visit 100 days back ran out inside the period, and she came back 80 days after it: retained.
    const pia = await client("Pia");
    await appointment(pia, at(100), "completed");
    await appointment(pia, at(20), "completed");
    await sale(pia, at(20), 7_000);
    // Lou: clock ran out in the previous period (visit 140 days back) and he came back 130 days later: lost there, returning now.
    const lou = await client("Lou");
    await appointment(lou, at(140), "completed");
    await appointment(lou, at(10), "completed");
    await sale(lou, at(10), 4_000);
    // Dan: clock ran out in the period but he has a visit booked after it: retained, and not lapsed today.
    const dan = await client("Dan");
    await appointment(dan, at(96), "completed");
    await appointment(dan, at(-3), "booked");
    // Hal: clock ran out in the period; the visit he had booked for after it has since happened (a historical period reads as it did then): retained.
    const hal = await client("Hal");
    await appointment(hal, at(97), "completed");
    await appointment(hal, at(-1), "completed");
    // Chloe: last visit 95 days back, never came back, nothing booked: lost in the period and lapsed today. Her spend in the year
    // before her clock ran out is the two later sales; the one 400 days back is too old.
    const chloe = await client("Chloe", { phone: "+15551230002" });
    await appointment(chloe, at(400), "completed");
    await sale(chloe, at(400), 6_000);
    await appointment(chloe, at(300), "completed");
    await sale(chloe, at(300), 15_000);
    chloeLast = await appointment(chloe, at(95), "completed");
    await sale(chloe, at(95), 20_000, 2_000);
    // Eve: her only visit was 140 days back: lost in the previous period, lapsed today.
    const eve = await client("Eve");
    await appointment(eve, at(140), "completed");
    await sale(eve, at(140), 4_000);
    // Fay: visited only in the previous period (new there, nothing now).
    const fay = await client("Fay");
    await appointment(fay, at(45), "completed");
    // Ivy: a class, not a visit, and a visit at the other location: new at every site or the Annex, not at Main.
    const ivy = await client("Ivy");
    await appointment(ivy, at(7), "completed", { kind: "class" });
    await appointment(ivy, at(6), "completed", { location: otherLocationId });
    await sale(ivy, at(6), 3_000, 0, otherLocationId);
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("counts new and returning clients with their revenue, and who was due back, retained and lost", async () => {
    const c = await clientCohorts(kit.A, from, to, { lapsedDays: 90 });
    expect(c.fresh).toEqual({ count: 2, revenueCents: 13_000 }); // Nina $100 and Ivy $30 (every site); tips are not revenue
    expect(c.returning).toEqual({ count: 3, revenueCents: 19_000 }); // Rae $80, Pia $70, Lou $40
    // Due back: Pia (came back in time), Dan (booked ahead), Hal (booked ahead, since completed), Chloe (never came back).
    expect([c.dueBack, c.retained, c.lost]).toEqual([4, 3, 1]);
    expect(c.lapsedDays).toBe(90);
  });

  it("gives the previous period its own figures, so the page can compare", async () => {
    const prev = await clientCohorts(kit.A, new Date(from.getTime() - 30 * DAY), from, { lapsedDays: 90 });
    expect(prev.fresh).toEqual({ count: 2, revenueCents: 5_000 }); // Rae (her $50) and Fay
    expect(prev.returning).toEqual({ count: 0, revenueCents: 0 });
    // Eve never came back; Lou came back 130 days later (too late, and not booked when that period ended).
    expect([prev.dueBack, prev.retained, prev.lost]).toEqual([2, 0, 2]);
  });

  it("lists who is lapsed right now by past spend, the way the We miss you automation counts them", async () => {
    const l = await lapsedClients(kit.A, { lapsedDays: 90 });
    expect(l.count).toBe(2);
    expect(l.revenueCents).toBe(39_000);
    expect(l.top.map((t) => ({ name: t.firstName, visits: t.visits, spend: t.spendCents, phone: t.phone, lastVisit: t.lastVisit.getTime() }))).toEqual([
      { name: "Chloe", visits: 3, spend: 35_000, phone: "+15551230002", lastVisit: chloeLast.getTime() },
      { name: "Eve", visits: 1, spend: 4_000, phone: null, lastVisit: expect.any(Number) },
    ]);
    // The automation reaches the slice whose clock ran out in the last week: Chloe (95 days), not Eve (140) and not Dan (booked ahead).
    const [w] = await withTenant(kit.A, (tx) => tx.insert(schema.workflows).values({ businessId: kit.A, name: "We miss you", trigger: "no_visit", enabled: true, filters: { days: 90 }, steps: [] }).returning());
    expect(await noVisitReach(business, w!)).toBe(1);
    expect((await lapsedClients(kit.A, { lapsedDays: 90, limit: 1 })).top.map((t) => t.firstName)).toEqual(["Chloe"]);
  });

  it("follows the location filter for visits and sales", async () => {
    const main = await clientCohorts(kit.A, from, to, { lapsedDays: 90, locationId });
    expect(main.fresh).toEqual({ count: 1, revenueCents: 10_000 }); // Ivy's visit was at the Annex
    expect([main.dueBack, main.lost]).toEqual([4, 1]);
    const annex = await clientCohorts(kit.A, from, to, { lapsedDays: 90, locationId: otherLocationId });
    expect(annex.fresh).toEqual({ count: 1, revenueCents: 3_000 });
    expect([annex.returning.count, annex.dueBack]).toEqual([0, 0]);
    expect((await lapsedClients(kit.A, { lapsedDays: 90, locationId: otherLocationId })).count).toBe(0);
  });

  it("moves with the lapsed-after setting", async () => {
    // At 120 days the clocks that ran out in the period are Eve's and Lou's (visits 140 days back); Lou came back 130 days later, too late.
    const long = await clientCohorts(kit.A, from, to, { lapsedDays: 120 });
    expect([long.dueBack, long.retained, long.lost]).toEqual([2, 0, 2]);
    const lapsed = await lapsedClients(kit.A, { lapsedDays: 120, limit: null });
    expect(lapsed.top.map((t) => t.firstName)).toEqual(["Eve"]); // Chloe's 95 days are not 120 yet
    // At 60 days every clock that could run out (visits 95 to 140 days back) did so before the period started: nobody was due back in it.
    const sixty = await clientCohorts(kit.A, from, to, { lapsedDays: 60 });
    expect([sixty.dueBack, sixty.retained, sixty.lost]).toEqual([0, 0, 0]);
  });

  it("is invisible to another business", async () => {
    const other = await clientCohorts(kit.B, from, to, { lapsedDays: 90 });
    expect([other.fresh.count, other.returning.count, other.dueBack, (await lapsedClients(kit.B, { lapsedDays: 90 })).count]).toEqual([0, 0, 0, 0]);
  });
});
