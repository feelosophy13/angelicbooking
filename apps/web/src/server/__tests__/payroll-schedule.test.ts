/**
 * Integration test for the pay schedule (REVIEW-PAYROLL-2026-10-19.md §6 item 1): the period the page opens on with and without a
 * schedule, salary prorated to the schedule on a custom run, and finalize refusing a period that overlaps a finalized one.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, periodContaining, weekStartOf } from "@angelic/core";
import { currentPeriod, finalizePayroll, resolveSchedule, runPayroll } from "@/server/payroll";
import { PayrollLockedError } from "@/server/payroll-lock";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

describe.skipIf(!up)("payroll: pay schedule", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let business: typeof schema.businesses.$inferSelect;
  let today: string;
  const reload = async () => (business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!);
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Bri", payType: "salary", salaryPerPeriodCents: 140_000, productCommissionBps: 0, ccTipFeeBps: 0 });
    });
    await reload();
    today = instantToISODate(new Date(), business.timezone);
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("with no schedule: two weeks from the week start, then from the latest finalized period; salary flat per run", async () => {
    const none = await resolveSchedule(business, today);
    expect(none.configured).toBe(false);
    expect(none.schedule).toEqual({ frequency: "biweekly", anchor: weekStartOf(today, business.weekStart) });
    expect(await currentPeriod(business, today)).toEqual({ start: weekStartOf(today, 1), end: shiftISODate(weekStartOf(today, 1), 13) });
    // A 7-day custom run still pays the whole salary while no schedule is set (today's behaviour, nothing silently halved).
    const r = await runPayroll(business, { start: shiftISODate(today, -60), end: shiftISODate(today, -54) }, false);
    expect(r.salaryShare).toBe(1);
    expect(r.employees[0]!.wageCents).toBe(140_000);
    // Once a period is finalized, the assumed schedule follows it.
    const start = shiftISODate(today, -200);
    await finalizePayroll(business, { start, end: shiftISODate(start, 13) }, false, userId);
    expect((await resolveSchedule(business, today)).schedule.anchor).toBe(start);
    expect(periodContaining((await resolveSchedule(business, today)).schedule, today).start).toBe(shiftISODate(start, 14 * Math.floor(200 / 14)));
  });

  it("with a biweekly schedule: the current period follows the anchor and a custom run prorates salary by days", async () => {
    const anchor = shiftISODate(today, -100);
    await db.update(schema.businesses).set({ payFrequency: "biweekly", payAnchorDate: anchor }).where(eq(schema.businesses.id, kit.A));
    await reload();
    const cur = await currentPeriod(business, today);
    expect(cur.start).toBe(shiftISODate(anchor, 14 * Math.floor(100 / 14)));
    expect(shiftISODate(cur.start, 13)).toBe(cur.end);
    expect((await runPayroll(business, cur, false)).employees[0]!.wageCents).toBe(140_000);
    const half = await runPayroll(business, { start: cur.start, end: shiftISODate(cur.start, 6) }, false);
    expect(half.salaryShare).toBe(0.5);
    expect(half.employees[0]!.wageCents).toBe(70_000);
    const twoAndAHalf = await runPayroll(business, { start: shiftISODate(cur.start, -28), end: shiftISODate(cur.start, 6) }, false);
    expect(twoAndAHalf.employees[0]!.wageCents).toBe(350_000);
  });

  it("semimonthly: the 1st–15th and 16th–end, each a whole salary", async () => {
    await db.update(schema.businesses).set({ payFrequency: "semimonthly", payAnchorDate: null }).where(eq(schema.businesses.id, kit.A));
    await reload();
    const cur = await currentPeriod(business, today);
    expect(cur.start.endsWith("-01") || cur.start.endsWith("-16")).toBe(true);
    expect((await runPayroll(business, cur, false)).employees[0]!.wageCents).toBe(140_000);
  });

  it("refuses to finalize a period that overlaps a finalized one, and allows the same period again (re-finalize)", async () => {
    const start = shiftISODate(today, -400);
    const end = shiftISODate(start, 13);
    await finalizePayroll(business, { start, end }, false, userId);
    await expect(finalizePayroll(business, { start: shiftISODate(start, 7), end: shiftISODate(end, 7) }, false, userId)).rejects.toBeInstanceOf(PayrollLockedError);
    await expect(finalizePayroll(business, { start: shiftISODate(start, -3), end: start }, false, userId)).rejects.toThrow(/overlaps/);
    await expect(finalizePayroll(business, { start, end }, false, userId)).resolves.toBeTruthy();
    await expect(finalizePayroll(business, { start: shiftISODate(end, 1), end: shiftISODate(end, 14) }, false, userId)).resolves.toBeTruthy();
  });
});
