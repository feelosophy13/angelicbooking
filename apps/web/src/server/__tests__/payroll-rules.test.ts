/**
 * Integration test for the commission rules (REVIEW-PAYROLL-2026-10-19.md §6 item 4): who absorbs discounts, the provider's share of
 * no-show fees, and the package redemption base. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { addServiceLine, openFeeSaleForAppointment, openWalkInSale, recordManualPayment, setDiscount, getSale } from "@/server/sales";
import { redeemCredit } from "@/server/offers";
import { buildPayrollLinesDetailed, runPayroll } from "@/server/payroll";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("payroll: commission rules", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let serviceId: string;
  let clientId: string;
  let business: typeof schema.businesses.$inferSelect;
  let today: string;
  const reload = async () => (business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!);
  const setRules = async (patch: Partial<typeof schema.businesses.$inferInsert>) => { await db.update(schema.businesses).set(patch).where(eq(schema.businesses.id, kit.A)); await reload(); };
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam", payType: "commission", mainCommissionBps: 5000, productCommissionBps: 0, ccTipFeeBps: 0 }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 60, priceCents: 10_000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      clientId = c!.id;
    });
    await reload();
    today = instantToISODate(new Date(), business.timezone);
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });
  const sam = async () => (await runPayroll(business, { start: today, end: today }, false)).employees.find((e) => e.employee.staffId === staffId)!;
  const linesOf = async (number: number) => (await buildPayrollLinesDetailed(business, { start: today, end: today })).lines.filter((l) => l.saleNumber === number);

  it("who absorbs discounts: provider (default), house, or split, with Amt Paid unchanged and the discount in the Disc column", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    await setDiscount({ businessId: kit.A, saleId, discount: { type: "amount", value: 2_000 }, note: null, taxRateBps: 0 });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 8_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const number = (await getSale(kit.A, saleId))!.sale.number;
    let [l] = await linesOf(number);
    expect([l!.amtPaidCents, l!.discountCents, l!.houseDiscountCents ?? 0]).toEqual([8_000, 2_000, 0]);
    expect((await sam()).mainCommissionCents).toBe(4_000);
    await setRules({ discountAbsorb: "house" });
    [l] = await linesOf(number);
    expect([l!.amtPaidCents, l!.discountCents, l!.houseDiscountCents]).toEqual([8_000, 2_000, 2_000]);
    expect((await sam()).mainCommissionCents).toBe(5_000);
    await setRules({ discountAbsorb: "split" });
    expect((await linesOf(number))[0]!.houseDiscountCents).toBe(1_000);
    expect((await sam()).mainCommissionCents).toBe(4_500);
    await setRules({ discountAbsorb: "provider" });
  });

  it("a no-show fee is the house's unless a share is set; then the appointment's provider gets that share in full", async () => {
    const apptId = await withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId }).returning({ id: schema.appointments.id });
      const start = new Date(Date.now() - 3_600_000);
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceId, serviceName: "Color", priceCents: 10_000, durationMinutes: 60, startAt: start, endAt: new Date(start.getTime() + 3_600_000) } as never);
      return a!.id;
    });
    const saleId = await openFeeSaleForAppointment({ businessId: kit.A, appointmentId: apptId, name: "No-show fee", feeCents: 3_000, actorUserId: userId, taxRateBps: 0, currency: "usd", auditAction: "appointment.no_show_fee" });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 3_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const number = (await getSale(kit.A, saleId))!.sale.number;
    const before = await buildPayrollLinesDetailed(business, { start: today, end: today });
    expect(before.lines.filter((l) => l.saleNumber === number)).toEqual([]);
    expect(before.omitted.filter((o) => o.saleNumber === number).map((o) => o.reason)).toEqual(["not commissionable"]);
    await setRules({ feeShareBps: 5000 });
    const [l] = await linesOf(number);
    expect([l!.staffId, l!.kind, l!.amtPaidCents, l!.cashCents, l!.name]).toEqual([staffId, "fee", 1_500, 1_500, "No-show fee · 50% share"]);
    const e = await sam();
    expect(e.feeShareCents).toBe(1_500);
    expect(e.totalCents).toBe(e.mainCommissionCents + 1_500);
    await setRules({ feeShareBps: 0 });
  });

  it("a package session credits the list price by default, or the package's per-session price when set", async () => {
    const packageId = await withTenant(kit.A, async (tx) => {
      const [p] = await tx.insert(schema.packages).values({ businessId: kit.A, name: "4 colors", serviceId, sessions: 4, priceCents: 30_000 }).returning({ id: schema.packages.id });
      await tx.insert(schema.clientPackages).values({ businessId: kit.A, clientId, packageId: p!.id, serviceId, remaining: 4 });
      return p!.id;
    });
    const cp = (await withTenant(kit.A, (tx) => tx.query.clientPackages.findFirst({ where: eq(schema.clientPackages.packageId, packageId) })))!;
    const redeem = async () => {
      const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
      await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
      const line = (await getSale(kit.A, saleId))!.lines[0]!;
      await redeemCredit({ businessId: kit.A, saleId, lineId: line.id, source: "package", sourceId: cp.id, actorUserId: userId });
      return (await getSale(kit.A, saleId))!.lines[0]!.creditCents;
    };
    expect(await redeem()).toBe(10_000);
    await setRules({ packageRedemptionBase: "package_share" });
    expect(await redeem()).toBe(7_500);
    await setRules({ packageRedemptionBase: "list" });
  });
});
