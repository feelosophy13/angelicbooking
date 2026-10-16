/**
 * Integration test for the second money batch: refunds made in Stripe's dashboard are recorded once, the last package session can't be
 * spent twice, membership credits only cover their included service, points are earned on services and products only (not stored value
 * or what was paid with points), and points can be redeemed twice on one ticket. Needs Postgres at DATABASE_URL (the app role, RLS
 * forced); skipped otherwise. Nothing here calls Stripe.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addProductLine, addServiceLine, getSale, openWalkInSale, recordManualPayment, recordStripeSideRefund } from "@/server/sales";
import { addOfferLine, redeemCredit } from "@/server/offers";
import { redeemPoints } from "@/server/loyalty";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("money tail", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let cut: string;
  let color: string;
  let productId: string;
  let clientId: string;
  const base = () => ({ businessId: kit.A, actorUserId: userId, taxRateBps: 0 });
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.update(schema.businesses).set({ loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyPointsPerVisit: 10, loyaltyPointValueCents: 10, loyaltyMinRedeemPoints: 1 }).where(eq(schema.businesses.id, kit.A));
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      cut = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning())[0]!.id;
      color = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 90, priceCents: 30000 }).returning())[0]!.id;
      productId = (await tx.insert(schema.products).values({ businessId: kit.A, name: "Serum", priceCents: 2000, kind: "retail" }).returning())[0]!.id;
      clientId = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning())[0]!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });
  const business = async () => (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  const ticket = async (services: string[]) => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    for (const serviceId of services) await addServiceLine({ ...base(), saleId, serviceId, staffId });
    return saleId;
  };

  it("records a refund made in Stripe's dashboard once, however many times Stripe reports it", async () => {
    const saleId = await ticket([cut]);
    const pi = `pi_dash_${kit.A}`;
    await withTenant(kit.A, (tx) => tx.insert(schema.payments).values({ businessId: kit.A, saleId, method: "card", status: "succeeded", amountCents: 5000, stripePaymentIntentId: pi, stripeAccountId: "acct_x" }));
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: 0, note: null }).catch(() => undefined);
    const report = () => recordStripeSideRefund({ businessId: kit.A, paymentIntentId: pi, refundedTotalCents: 2000, refundId: "re_1", taxRateBps: 0 });
    await report();
    await report();
    const d = (await getSale(kit.A, saleId))!;
    expect(d.refunds.map((r) => [r.amountCents, r.stripeRefundId])).toEqual([[2000, "re_1"]]);
    expect(d.payments[0]!.refundedCents).toBe(2000);
  });

  it("won't spend the last package session twice, or a membership credit on another service", async () => {
    const pkg = (await withTenant(kit.A, (tx) => tx.insert(schema.packages).values({ businessId: kit.A, name: "Cut x1", sessions: 1, priceCents: 4000, serviceId: cut }).returning()))[0]!;
    const cp = (await withTenant(kit.A, (tx) => tx.insert(schema.clientPackages).values({ businessId: kit.A, clientId, packageId: pkg.id, serviceId: cut, remaining: 1 }).returning()))[0]!;
    const a = await ticket([cut]);
    const b = await ticket([cut]);
    const lineOf = async (saleId: string) => (await getSale(kit.A, saleId))!.lines.find((l) => l.kind === "service")!.id;
    const use = async (saleId: string) => redeemCredit({ businessId: kit.A, saleId, lineId: await lineOf(saleId), source: "package", sourceId: cp.id, actorUserId: userId });
    const both = await Promise.allSettled([use(a), use(b)]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBe(1);

    const plan = (await withTenant(kit.A, (tx) => tx.insert(schema.membershipPlans).values({ businessId: kit.A, name: "Cut club", priceCents: 4000, includedSessions: 2, includedServiceId: cut }).returning()))[0]!;
    const m = (await withTenant(kit.A, (tx) => tx.insert(schema.clientMemberships).values({ businessId: kit.A, clientId, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), creditsRemaining: 2 }).returning()))[0]!;
    const c = await ticket([color]);
    await expect(redeemCredit({ businessId: kit.A, saleId: c, lineId: await lineOf(c), source: "membership", sourceId: m.id, actorUserId: userId })).rejects.toThrow(/different service/);
  });

  it("earns points on services and products only, not on gift cards or what was paid with points", async () => {
    await withTenant(kit.A, (tx) => tx.insert(schema.loyaltyLedger).values({ businessId: kit.A, clientId, delta: 500, reason: "adjust" }));
    const saleId = await ticket([cut]); // $50
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId }); // $20
    await addOfferLine({ businessId: kit.A, saleId, kind: "gift_card", refId: null, amountCents: 10000 }); // $100, no points
    const b = await business();
    await redeemPoints({ business: b, saleId, points: 50, actorUserId: userId }); // $5
    await redeemPoints({ business: b, saleId, points: 50, actorUserId: userId }); // another $5, same ticket
    const d = (await getSale(kit.A, saleId))!;
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: d.sale.totalCents - d.sale.paidCents, note: null });
    const earned = await withTenant(kit.A, (tx) => tx.select().from(schema.loyaltyLedger).where(and(eq(schema.loyaltyLedger.saleId, saleId), eq(schema.loyaltyLedger.reason, "earn"))));
    // ($50 + $20 − $10 paid in points) × 1 point/$ + 10 for the visit
    expect(earned.map((e) => e.delta)).toEqual([70]);
  });
});
