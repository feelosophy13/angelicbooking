/**
 * Reports: package and membership money on the usage basis. A package sold and a membership billed are "Prepaid sold"; each session used
 * counts in the category of the service performed, at the session's value, next to what was paid at the visit; Provider pay is what
 * Payroll credits on those lines. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { addServiceLine, completeNoCharge, getSale, openWalkInSale, recordManualPayment, refundPayment, salesReport } from "@/server/sales";
import { addOfferLine, redeemCredit } from "@/server/offers";
import { payByCategory } from "@/server/payroll";
import { listCategories } from "@/server/categories";
import { rollUpCategories } from "@/lib/category-rollup";
import { shiftISODate } from "@/lib/utils";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("reports: prepaid sold and used by category", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let clientId: string;
  let colorId: string;
  let manicureId: string;
  let hairId: string;
  let nailsId: string;
  let packageId: string;
  let planId: string;
  let business: typeof schema.businesses.$inferSelect;
  let today: string;
  let paidColorSaleId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam", payType: "commission", mainCommissionBps: 5000, productCommissionBps: 0, ccTipFeeBps: 0 }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [hair] = await tx.insert(schema.serviceCategories).values({ businessId: kit.A, name: "Hair" }).returning({ id: schema.serviceCategories.id });
      const [nails] = await tx.insert(schema.serviceCategories).values({ businessId: kit.A, name: "Nails" }).returning({ id: schema.serviceCategories.id });
      hairId = hair!.id;
      nailsId = nails!.id;
      const [color] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 60, priceCents: 10_000, categoryId: hairId }).returning({ id: schema.services.id });
      const [mani] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Manicure", durationMin: 30, priceCents: 4_000, categoryId: nailsId }).returning({ id: schema.services.id });
      colorId = color!.id;
      manicureId = mani!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      clientId = c!.id;
      // Any-service package: 3 sessions for $150, so a session is worth $50 on the default (package share) base.
      const [p] = await tx.insert(schema.packages).values({ businessId: kit.A, name: "3 sessions", sessions: 3, priceCents: 15_000 }).returning({ id: schema.packages.id });
      packageId = p!.id;
      const [m] = await tx.insert(schema.membershipPlans).values({ businessId: kit.A, name: "Glow", priceCents: 9_900, includedSessions: 2 }).returning({ id: schema.membershipPlans.id });
      planId = m!.id;
    });
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    today = instantToISODate(new Date(), business.timezone);

    const open = () => openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    const cash = (saleId: string, amountCents: number) => recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents, note: null, actorUserId: userId, taxRateBps: 0 });
    // Sell the package and the first membership period at the desk.
    let saleId = await open();
    await addOfferLine({ businessId: kit.A, saleId, kind: "package", refId: packageId, amountCents: null, staffId });
    await cash(saleId, 15_000);
    saleId = await open();
    await addOfferLine({ businessId: kit.A, saleId, kind: "membership", refId: planId, amountCents: null });
    await cash(saleId, 9_900);
    const cp = (await withTenant(kit.A, (tx) => tx.query.clientPackages.findFirst({ where: eq(schema.clientPackages.clientId, clientId) })))!;
    const cm = (await withTenant(kit.A, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.clientId, clientId) })))!;
    expect([cp.remaining, cm.creditsRemaining]).toEqual([3, 2]);
    // Use a package session on a Color (Hair) and a membership session on a Manicure (Nails).
    const redeem = async (serviceId: string, source: "package" | "membership", sourceId: string) => {
      const id = await open();
      await addServiceLine({ businessId: kit.A, saleId: id, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
      const line = (await getSale(kit.A, id))!.lines[0]!;
      await redeemCredit({ businessId: kit.A, saleId: id, lineId: line.id, source, sourceId, actorUserId: userId });
      await completeNoCharge({ businessId: kit.A, saleId: id, actorUserId: userId, taxRateBps: 0 });
    };
    await redeem(colorId, "package", cp.id);
    await redeem(manicureId, "membership", cm.id);
    // And one Color paid in full at the visit.
    paidColorSaleId = await open();
    await addServiceLine({ businessId: kit.A, saleId: paidColorSaleId, serviceId: colorId, staffId, taxRateBps: 0, actorUserId: userId });
    await cash(paidColorSaleId, 10_000);
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });
  const range = () => [zonedToInstant(today, "00:00", business.timezone), zonedToInstant(shiftISODate(today, 1), "00:00", business.timezone)] as const;
  const report = () => salesReport(business.id, ...range());
  const rows = async () => rollUpCategories((await report()).byCategory, await listCategories(business.id, "service"), await payByCategory(business, { start: today, end: today }));

  it("sessions used count in the performed service's category at their value, next to what was paid at the visit", async () => {
    const r = await rows();
    expect(r.map((x) => [x.name, x.count, x.paid, x.credit])).toEqual([
      ["Hair", 2, 10_000, 5_000],
      ["Nails", 1, 0, 4_000],
    ]);
    expect(r.map((x) => x.id)).toEqual([hairId, nailsId]);
  });

  it("Provider pay is Payroll's commission on those lines, credit included, and Profit is the rest", async () => {
    const r = await rows();
    const profit = (x: (typeof r)[number]) => x.paid + x.credit - (x.pay ?? 0);
    expect(r.map((x) => [x.name, x.pay, profit(x)])).toEqual([
      ["Hair", 7_500, 7_500],
      ["Nails", 2_000, 2_000],
    ]);
  });

  it("Prepaid sold is the package and the membership fee; Prepaid used is the value of the sessions redeemed", async () => {
    const { prepaidSold, prepaidUsedCents, byService } = await report();
    expect(prepaidSold).toEqual({ packagesCents: 15_000, packagesCount: 1, membershipCents: 9_900, membershipCount: 1 });
    expect(prepaidUsedCents).toBe(9_000);
    // The fee is its own line among the top items, never a category; the package shows by name.
    expect(byService.map((x) => [x.name, x.kind, Number(x.amount)])).toEqual(expect.arrayContaining([["Membership fees", "membership", 9_900], ["3 sessions (3 sessions)", "package", 15_000]]));
    expect(byService.filter((x) => x.kind === "membership")).toHaveLength(1);
  });

  it("a refund takes pay back on the refund date; category revenue stays gross, like service lines today", async () => {
    const payment = (await getSale(kit.A, paidColorSaleId))!.payments[0]!;
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: payment.id, amountCents: 10_000, reason: null, actorUserId: userId, taxRateBps: 0 });
    const r = await rows();
    const hair = r.find((x) => x.id === hairId)!;
    expect([hair.paid, hair.credit, hair.pay]).toEqual([10_000, 5_000, 2_500]);
    expect((await report()).refundsCents).toBe(10_000);
  });
});
