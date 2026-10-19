/**
 * Integration test: refunds are booked on the day they happen (a refund after a period was paid comes off the next one, and the paid
 * period re-runs the same), refunds to store credit claw back too, and finalized periods lock their hours, adjustments and pay rates.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party.
 *
 * Dates: "today" is the clock's date in the business's zone, and every row this file back- or forward-dates is stamped at noon local on a
 * calendar day (`at()`), never `now ± n × 24 h` (that lands a day off when the span crosses a DST change and the run is within an hour of
 * midnight). TEST_NOW=<ISO instant> runs the file as if on another date.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { addServiceLine, openWalkInSale, recordManualPayment, refundPayment, refundToStoreCredit, getSale } from "@/server/sales";
import { buildPayrollLines, buildPayrollLinesDetailed } from "@/server/payroll";
import { assertPeriodOpen, PayrollLockedError } from "@/server/payroll-lock";
import { recordPayChange } from "@/server/pay-rates";
import { ClockError, ensureClockToken, openEntryFor, punchWithPin, setClockPin } from "@/server/time-clock";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("payroll: refunds by date, finalized periods locked", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let serviceId: string;
  let clientId: string;
  let business: typeof schema.businesses.$inferSelect;
  let today: string;
  beforeAll(async () => {
    // TEST_NOW=<ISO instant> pins the clock (Date only; timers stay real so the pool works) to check the file on another calendar date.
    if (process.env.TEST_NOW) vi.useFakeTimers({ toFake: ["Date"], now: new Date(process.env.TEST_NOW) });
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 60, priceCents: 10_000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      clientId = c!.id;
    });
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    today = instantToISODate(new Date(), business.timezone);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  /** A paid $100 service ticket for Sam, paid in cash; returns the sale and its payment. */
  async function paidSale() {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 10_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const d = (await getSale(kit.A, saleId))!;
    return { saleId, number: d.sale.number, paymentId: d.payments[0]!.id };
  }
  /** Noon in the business's zone on a calendar day: an instant that is unambiguously that day. */
  const at = (date: string) => zonedToInstant(date, "12:00", business.timezone);
  const mine = async (start: string, end: string, saleNumber: number) => (await buildPayrollLines(business, { start, end })).filter((l) => l.saleNumber === saleNumber).map((l) => [l.date, l.amtPaidCents]);

  it("books a later refund on its own day: the paid period re-runs the same, the next one takes it back", async () => {
    const { number, paymentId } = await paidSale();
    await refundPayment({ businessId: kit.A, accountId: null, paymentId, amountCents: 4000, reason: "unhappy", actorUserId: userId, taxRateBps: 0 });
    // Pretend the refund happened 20 days after the visit.
    const later = shiftISODate(today, 20);
    await withTenant(kit.A, (tx) => tx.update(schema.refunds).set({ createdAt: at(later) }).where(eq(schema.refunds.paymentId, paymentId)));
    expect(await mine(today, today, number)).toEqual([[today, 10_000]]);
    expect(await mine(shiftISODate(today, 14), shiftISODate(today, 27), number)).toEqual([[later, -4000]]);
    expect((await buildPayrollLines(business, { start: later, end: later })).find((l) => l.saleNumber === number)!.name).toMatch(/^Refund · /);
  });

  it("claws back a refund given as store credit", async () => {
    const { number, paymentId } = await paidSale();
    await refundToStoreCredit({ businessId: kit.A, paymentId, amountCents: 2500, reason: null, actorUserId: userId });
    // The ledger row is stamped by Postgres (now()), which TEST_NOW cannot move: date it today like the sale.
    await withTenant(kit.A, (tx) => tx.update(schema.storeCreditLedger).set({ createdAt: at(today) }).where(eq(schema.storeCreditLedger.paymentId, paymentId)));
    expect(await mine(today, today, number)).toEqual([[today, 10_000], [today, -2500]]);
  });

  it("locks hours, adjustments and pay rates inside a finalized period", async () => {
    const start = shiftISODate(today, -60);
    const end = shiftISODate(today, -47);
    await withTenant(kit.A, (tx) => tx.insert(schema.payrollRuns).values({ businessId: kit.A, periodStart: start, periodEnd: end, snapshot: { employees: [] } }));
    await expect(withTenant(kit.A, (tx) => assertPeriodOpen(tx, shiftISODate(start, 3), "Hours"))).rejects.toBeInstanceOf(PayrollLockedError);
    await expect(withTenant(kit.A, (tx) => assertPeriodOpen(tx, shiftISODate(end, 1), "Hours"))).resolves.toBeUndefined();
    const rates = { payType: "commission" as const, mainCommissionBps: 4500, productCommissionBps: 500, ccTipFeeBps: 300, hourlyRateCents: 0, salaryPerPeriodCents: 0, overtimeOverride: null, taxDeductionCents: null, taxDeductionBps: null };
    await expect(recordPayChange({ businessId: kit.A, timezone: business.timezone, staffId, effectiveFrom: shiftISODate(end, -2), rates, note: null, actorUserId: userId })).rejects.toThrow(/finalized through/);
    await expect(recordPayChange({ businessId: kit.A, timezone: business.timezone, staffId, effectiveFrom: shiftISODate(end, 1), rates, note: null, actorUserId: userId })).resolves.toBeUndefined();
  });
  it("a whole-ticket refund takes back the service, never the tip (the tip is the stylist's unless the tip itself is refunded)", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    await withTenant(kit.A, (tx) => tx.insert(schema.saleLines).values({ businessId: kit.A, saleId, kind: "tip", tipMethod: "cash", staffId, name: "Tip", quantity: 1, unitCents: 2000, amountCents: 2000 }));
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 12_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const d = (await getSale(kit.A, saleId))!;
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: d.payments[0]!.id, amountCents: 12_000, reason: "whole ticket", actorUserId: userId, taxRateBps: 0 });
    const rows = (await buildPayrollLines(business, { start: today, end: today })).filter((l) => l.saleNumber === d.sale.number);
    expect(rows.map((l) => [l.name, l.amtPaidCents, l.cashTipCents])).toEqual([["Color", 12_000, 2000], ["Refund · Color", -10_000, 0]]);
    // Net to the stylist: the tip stays, the service money is gone.
    expect(rows.reduce((n, l) => n + l.amtPaidCents - l.cashTipCents, 0)).toBe(0);
    expect(rows.reduce((n, l) => n + l.cashTipCents, 0)).toBe(2000);
  });

  it("pays a ticket closed after its visit's period was finalized in the period it closed, as a late ticket, and lists it in the quality check", async () => {
    // A visit 30 days ago, inside a period that was finalized 10 days ago; the ticket closes today.
    const visit = shiftISODate(today, -30);
    const pStart = shiftISODate(today, -35);
    const pEnd = shiftISODate(today, -22);
    await withTenant(kit.A, (tx) => tx.insert(schema.payrollRuns).values({ businessId: kit.A, periodStart: pStart, periodEnd: pEnd, snapshot: { employees: [] }, createdAt: at(shiftISODate(today, -10)) }));
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    // Tie the line to a visit on that day (as a ticket opened from the appointment would be).
    await withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId }).returning({ id: schema.appointments.id });
      const [i] = await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceId, serviceName: "Color", priceCents: 10_000, durationMinutes: 60, startAt: at(visit), endAt: new Date(at(visit).getTime() + 3_600_000) } as never).returning({ id: schema.appointmentItems.id });
      await tx.update(schema.saleLines).set({ appointmentItemId: i!.id }).where(eq(schema.saleLines.saleId, saleId));
    });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 10_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const number = (await getSale(kit.A, saleId))!.sale.number;
    // Not in the closed book, even though the visit is there.
    expect(await mine(pStart, pEnd, number)).toEqual([]);
    const now = (await buildPayrollLinesDetailed(business, { start: shiftISODate(today, -7), end: today }));
    expect(now.lines.filter((l) => l.saleNumber === number).map((l) => [l.date, l.name, l.amtPaidCents])).toEqual([[today, `Late ticket · ${visit} · Color`, 10_000]]);
    // Closed in this period but paid as a late ticket: the ledger says so (nothing is dropped silently).
    expect(now.omitted.filter((o) => o.saleNumber === number)).toEqual([]);
    // The closed period's ledger lists it as out of period when that period is re-run.
    const then = await buildPayrollLinesDetailed(business, { start: pStart, end: pEnd });
    expect(then.lines.filter((l) => l.saleNumber === number)).toEqual([]);
  });

  it("a service with nobody credited is in the quality check, not silently dropped", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId: null, taxRateBps: 0, actorUserId: userId });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 10_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const number = (await getSale(kit.A, saleId))!.sale.number;
    const r = await buildPayrollLinesDetailed(business, { start: today, end: today });
    expect(r.lines.filter((l) => l.saleNumber === number)).toEqual([]);
    expect(r.omitted.filter((o) => o.saleNumber === number).map((o) => [o.reason, o.amountCents])).toEqual([["no staff credited", 10_000]]);
  });

  it("kiosk punches and the 14-hour auto-close respect a finalized period like web entries", async () => {
    // Finalize a period that contains today, then try to punch.
    await withTenant(kit.A, (tx) => tx.insert(schema.payrollRuns).values({ businessId: kit.A, periodStart: shiftISODate(today, -3), periodEnd: shiftISODate(today, 3), snapshot: { employees: [] } }));
    const locationId = (await withTenant(kit.A, (tx) => tx.query.locations.findFirst({ columns: { id: true } })))!.id;
    const token = await ensureClockToken(kit.A, locationId);
    await setClockPin(kit.A, staffId, "4321");
    await expect(punchWithPin(token, "4321")).rejects.toBeInstanceOf(ClockError);
    await expect(punchWithPin(token, "4321")).rejects.toThrow(/finalized/);
    // An entry left open inside the finalized period is not auto-closed into it.
    const openId = await withTenant(kit.A, async (tx) => {
      const [e] = await tx.insert(schema.timeEntries).values({ businessId: kit.A, staffId, date: shiftISODate(today, -2), minutes: 0, clockInAt: at(shiftISODate(today, -2)), locationId }).returning({ id: schema.timeEntries.id });
      return e!.id;
    });
    expect(await withTenant(kit.A, (tx) => openEntryFor(tx, staffId, new Date()))).toBeNull();
    const still = await withTenant(kit.A, (tx) => tx.query.timeEntries.findFirst({ where: eq(schema.timeEntries.id, openId) }));
    expect(still?.clockOutAt).toBeNull();
    expect(still?.minutes).toBe(0);
    await withTenant(kit.A, (tx) => tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.periodStart, shiftISODate(today, -3))));
  });

  it("pays a tip added to an old ticket in the period it was added, not the closed one", async () => {
    const { saleId, number } = await paidSale();
    // A $15 cash tip added 20 days after the visit (as addTipAfterPayment would, dated then).
    const later = shiftISODate(today, 20);
    await withTenant(kit.A, (tx) => tx.insert(schema.saleLines).values({ businessId: kit.A, saleId, kind: "tip", tipMethod: "cash", staffId, name: "Tip", quantity: 1, unitCents: 1500, amountCents: 1500, createdAt: at(later) }));
    expect(await mine(today, today, number)).toEqual([[today, 10_000]]);
    const next = (await buildPayrollLines(business, { start: shiftISODate(today, 14), end: shiftISODate(today, 27) })).filter((l) => l.saleNumber === number);
    expect(next.map((l) => [l.date, l.name, l.cashTipCents])).toEqual([[later, "Tip (added later)", 1500]]);
  });
});
