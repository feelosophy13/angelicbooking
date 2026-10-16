/**
 * Integration test for line-item refunds: refunding one item takes back exactly that item from the pay of whoever was credited on it,
 * a line can't be refunded past what was paid for it, a refunded gift card loses that balance, and a refunded tip comes off tips.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party (cash payments).
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { addProductLine, addServiceLine, getSale, openWalkInSale, recordManualPayment, refundableLines, refundPayment, refundToStoreCredit, setTips } from "@/server/sales";
import { addOfferLine } from "@/server/offers";
import { buildPayrollLines } from "@/server/payroll";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("line-item refunds", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let stylist: string;
  let seller: string;
  let serviceId: string;
  let productId: string;
  let clientId: string;
  let business: typeof schema.businesses.$inferSelect;
  let today: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [a] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Stylist" }).returning({ id: schema.staff.id });
      const [b] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Seller" }).returning({ id: schema.staff.id });
      stylist = a!.id;
      seller = b!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut and color", durationMin: 90, priceCents: 15_000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
      const [p] = await tx.insert(schema.products).values({ businessId: kit.A, name: "Shampoo", priceCents: 3000, taxable: false, kind: "retail" }).returning({ id: schema.products.id });
      productId = p!.id;
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

  const base = () => ({ businessId: kit.A, actorUserId: userId, taxRateBps: 0 });
  async function ticket(build: (saleId: string) => Promise<void>, pay: number) {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await build(saleId);
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: pay, note: null });
    const d = (await getSale(kit.A, saleId))!;
    return { saleId, d, lineOf: (kind: string) => d.lines.find((l) => l.kind === kind)!.id, paymentId: d.payments[0]!.id };
  }
  const clawback = async (number: number) => (await buildPayrollLines(business, { start: today, end: today })).filter((l) => l.saleNumber === number && l.amtPaidCents < 0).map((l) => [l.staffId, l.name, l.amtPaidCents, l.cashTipCents]);

  it("refunds just the shampoo: the seller loses that, the stylist's service is untouched", async () => {
    const t = await ticket(async (saleId) => {
      await addServiceLine({ ...base(), saleId, serviceId, staffId: stylist });
      await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId: seller });
    }, 18_000);
    await refundPayment({ ...base(), accountId: null, paymentId: t.paymentId, amountCents: 0, reason: "returned", items: [{ saleLineId: t.lineOf("product"), amountCents: 3000 }] });
    expect(await clawback(t.d.sale.number)).toEqual([[seller, "Refund · Shampoo", -3000, 0]]);
    const after = (await getSale(kit.A, t.saleId))!;
    expect(after.sale.refundedCents).toBe(3000);
    const left = await refundableLines(kit.A, t.saleId);
    expect(left.find((l) => l.kind === "product")!.remainingCents).toBe(0);
    await expect(refundPayment({ ...base(), accountId: null, paymentId: t.paymentId, amountCents: 0, reason: null, items: [{ saleLineId: t.lineOf("product"), amountCents: 100 }] })).rejects.toThrow(/already been refunded/);
    await expect(refundPayment({ ...base(), accountId: null, paymentId: t.paymentId, amountCents: 0, reason: null, items: [{ saleLineId: t.lineOf("service"), amountCents: 15_001 }] })).rejects.toThrow(/only 150.00 is left/);
  });

  it("refunding a gift card takes it off the card, and never more than is left on it", async () => {
    const t = await ticket(async (saleId) => {
      await addOfferLine({ businessId: kit.A, saleId, kind: "gift_card", refId: null, amountCents: 5000, recipientName: "Mom" });
    }, 5000);
    const card = await withTenant(kit.A, (tx) => tx.query.giftCards.findFirst({ where: eq(schema.giftCards.saleId, t.saleId) }));
    await withTenant(kit.A, (tx) => tx.update(schema.giftCards).set({ balanceCents: 2000 }).where(eq(schema.giftCards.id, card!.id))); // $30 already spent
    await expect(refundToStoreCredit({ businessId: kit.A, paymentId: t.paymentId, amountCents: 0, reason: null, actorUserId: userId, items: [{ saleLineId: t.lineOf("gift_card"), amountCents: 2500 }] })).rejects.toThrow(/left on the gift card/);
    await refundToStoreCredit({ businessId: kit.A, paymentId: t.paymentId, amountCents: 0, reason: null, actorUserId: userId, items: [{ saleLineId: t.lineOf("gift_card"), amountCents: 2000 }] });
    const after = await withTenant(kit.A, (tx) => tx.query.giftCards.findFirst({ where: eq(schema.giftCards.id, card!.id) }));
    expect([after!.balanceCents, after!.active]).toEqual([0, false]);
  });

  it("refunding a tip takes it off that person's tips", async () => {
    const t = await ticket(async (saleId) => {
      await addServiceLine({ ...base(), saleId, serviceId, staffId: stylist });
      await setTips({ businessId: kit.A, saleId, tips: [{ staffId: stylist, amountCents: 2000, method: "cash" }], taxRateBps: 0 });
    }, 17_000);
    await refundPayment({ ...base(), accountId: null, paymentId: t.paymentId, amountCents: 0, reason: null, items: [{ saleLineId: t.lineOf("tip"), amountCents: 2000 }] });
    expect(await clawback(t.d.sale.number)).toEqual([[stylist, "Refund · Tip", -2000, -2000]]);
  });
  it("refunding a renewal takes back that period; refunding the ticket that started a membership cancels it", async () => {
    const plan = (await withTenant(kit.A, (tx) => tx.insert(schema.membershipPlans).values({ businessId: kit.A, name: "Blowout club", priceCents: 6000, includedSessions: 2 }).returning()))[0]!;
    const sell = () => ticket((saleId) => addOfferLine({ businessId: kit.A, saleId, kind: "membership", refId: plan.id, amountCents: 6000 }).then(() => undefined), 6000);
    const membership = async () => (await withTenant(kit.A, (tx) => tx.query.clientMemberships.findFirst({ where: eq(schema.clientMemberships.planId, plan.id) })))!;
    const first = await sell();
    const started = await membership();
    expect([started.saleId, started.cyclesBilled, started.creditsRemaining]).toEqual([first.saleId, 1, 2]);
    const renewal = await sell();
    const renewed = await membership();
    expect([renewed.cyclesBilled, renewed.creditsRemaining]).toEqual([2, 2]); // no rollover: credits reset
    expect(renewed.currentPeriodEnd.getTime()).toBeGreaterThan(started.currentPeriodEnd.getTime());
    await refundToStoreCredit({ businessId: kit.A, paymentId: renewal.paymentId, amountCents: 0, reason: null, actorUserId: userId, items: [{ saleLineId: renewal.lineOf("membership"), amountCents: 6000 }] });
    const back = await membership();
    expect([back.status, back.cyclesBilled, back.creditsRemaining, back.currentPeriodEnd.getTime()]).toEqual(["active", 1, 2, started.currentPeriodEnd.getTime()]);
    // The whole first ticket, not itemized: the membership it started is cancelled.
    await refundPayment({ ...base(), accountId: null, paymentId: first.paymentId, amountCents: 6000, reason: null });
    const gone = await membership();
    expect([gone.status, gone.creditsRemaining]).toEqual(["cancelled", 0]);
  });
});
