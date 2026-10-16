/**
 * Integration test: refunds are booked on the day they happen (a refund after a period was paid comes off the next one, and the paid
 * period re-runs the same), refunds to store credit claw back too, and finalized periods lock their hours, adjustments and pay rates.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { addServiceLine, openWalkInSale, recordManualPayment, refundPayment, refundToStoreCredit, getSale } from "@/server/sales";
import { buildPayrollLines } from "@/server/payroll";
import { assertPeriodOpen, PayrollLockedError } from "@/server/payroll-lock";
import { recordPayChange } from "@/server/pay-rates";
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
  const mine = async (start: string, end: string, saleNumber: number) => (await buildPayrollLines(business, { start, end })).filter((l) => l.saleNumber === saleNumber).map((l) => [l.date, l.amtPaidCents]);

  it("books a later refund on its own day: the paid period re-runs the same, the next one takes it back", async () => {
    const { number, paymentId } = await paidSale();
    await refundPayment({ businessId: kit.A, accountId: null, paymentId, amountCents: 4000, reason: "unhappy", actorUserId: userId, taxRateBps: 0 });
    // Pretend the refund happened 20 days after the visit.
    const later = shiftISODate(today, 20);
    await withTenant(kit.A, (tx) => tx.update(schema.refunds).set({ createdAt: new Date(Date.now() + 20 * 86_400_000) }).where(eq(schema.refunds.paymentId, paymentId)));
    expect(await mine(today, today, number)).toEqual([[today, 10_000]]);
    expect(await mine(shiftISODate(today, 14), shiftISODate(today, 27), number)).toEqual([[later, -4000]]);
    expect((await buildPayrollLines(business, { start: later, end: later })).find((l) => l.saleNumber === number)!.name).toMatch(/^Refund · /);
  });

  it("claws back a refund given as store credit", async () => {
    const { number, paymentId } = await paidSale();
    await refundToStoreCredit({ businessId: kit.A, paymentId, amountCents: 2500, reason: null, actorUserId: userId });
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
});
