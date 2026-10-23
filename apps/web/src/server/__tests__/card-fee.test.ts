// Card surcharge / convenience fee, end to end against a fake Helcim API (fetch is replaced) and the real database: the fee is charged with
// the card and lands on the ticket as its own line, goes back in proportion with refunds (to the card or as store credit), stays out of
// commission, tips and Sales in Reports, and is skipped where the processor can't tell a debit card. Nothing here talks to Helcim or Stripe.
import "../../../../../packages/db/src/env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addServiceLine, chargeHelcimSavedCard, getSale, openWalkInSale, recordManualPayment, refundPayment, refundToStoreCredit, salesReport } from "@/server/sales";
import { buildPayrollLines } from "@/server/payroll";
import { openHelcimCheckout } from "@/server/helcim/online";
import { encryptSecret } from "@/lib/secrets";
import { instantToISODate } from "@angelic/core";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const TOKEN = "helcim-test-token-1234567890";

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
let nextId = 7000;
const realFetch = globalThis.fetch;

function fakeHelcim() {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const c: Call = { method: init?.method ?? "GET", path: u.pathname.replace(/^\/v2/, ""), body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const amount = (c.body as { amount?: number } | null)?.amount;
    const out =
      c.path === "/payment/purchase" ? { transactionId: nextId++, status: "APPROVED", type: "purchase", amount, cardType: "VI", cardNumber: "4242424242", invoiceNumber: (c.body as { invoiceNumber?: string }).invoiceNumber }
      : c.path === "/payment/refund" ? { transactionId: nextId++, status: "APPROVED", type: "refund", amount }
      : c.path === "/customers" ? { id: 77, customerCode: (c.body as { customerCode: string }).customerCode }
      : c.path === "/helcim-pay/initialize" ? { checkoutToken: "chk_1", secretToken: "sec_1" }
      : { errors: [`unexpected ${c.method} ${c.path}`] };
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe.skipIf(!up)("card fee", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let serviceId: string;
  let clientId: string;
  let business: typeof schema.businesses.$inferSelect;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    // Helcim can't tell debit from credit, so the fee applies to it only with the debit exemption off.
    await db.update(schema.businesses).set({ paymentProvider: "helcim", helcimApiToken: encryptSecret(TOKEN), cardFeeType: "surcharge", cardFeeBps: 300, cardFeeDesk: true, cardFeeOnline: true, cardFeeStore: false, cardFeeDebitExempt: false }).where(eq(schema.businesses.id, kit.A));
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 60, priceCents: 10_000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", lastName: "Ruiz" }).returning({ id: schema.clients.id });
      clientId = c!.id;
    });
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    calls.length = 0;
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  /** A $100 service ticket for Sam, charged to the client's saved Helcim card. */
  async function paidByCard() {
    fakeHelcim();
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    await chargeHelcimSavedCard({ businessId: kit.A, saleId, token: TOKEN, cardToken: "tok", customerCode: clientId, amountCents: 10_000, actorUserId: userId, taxRateBps: 0, ipAddress: "203.0.113.5" });
    return saleId;
  }

  it("charges the fee with the card and puts it on the ticket as its own line", async () => {
    const saleId = await paidByCard();
    expect(calls.find((c) => c.path === "/payment/purchase")!.body).toMatchObject({ amount: 103 });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale).toMatchObject({ status: "paid", subtotalCents: 10_000, cardFeeCents: 300, totalCents: 10_300, paidCents: 10_300 });
    const fee = d.lines.filter((l) => l.kind === "card_fee");
    expect(fee.map((l) => [l.name, l.amountCents, l.staffId, l.paymentId])).toEqual([["Card surcharge (3%)", 300, null, d.payments[0]!.id]]);
    expect(d.payments[0]).toMatchObject({ amountCents: 10_300, surchargeCents: 300 });
  });

  it("adds no fee to cash", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    await recordManualPayment({ businessId: kit.A, saleId, method: "cash", amountCents: 10_000, note: null, actorUserId: userId, taxRateBps: 0 });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale).toMatchObject({ status: "paid", cardFeeCents: 0, totalCents: 10_000 });
    expect(d.lines.some((l) => l.kind === "card_fee")).toBe(false);
  });

  it("refunds the fee in proportion, and all of what is left with the rest", async () => {
    const saleId = await paidByCard();
    let p = (await getSale(kit.A, saleId))!.payments[0]!;
    fakeHelcim();
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: p.id, amountCents: 4_000, reason: null, actorUserId: userId, taxRateBps: 0, helcimToken: TOKEN, ipAddress: "203.0.113.5" });
    expect(calls.find((c) => c.path === "/payment/refund")!.body).toMatchObject({ amount: 41.2 });
    let d = (await getSale(kit.A, saleId))!;
    p = d.payments[0]!;
    expect([p.refundedCents, p.surchargeRefundedCents, p.status]).toEqual([4_120, 120, "partially_refunded"]);
    expect(d.refunds.map((r) => [r.amountCents, r.surchargeCents])).toEqual([[4_120, 120]]);
    // More than is left (without the fee) is trimmed to what is left: $60 back, plus the last $1.80 of the fee.
    calls.length = 0;
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: p.id, amountCents: 9_000, reason: null, actorUserId: userId, taxRateBps: 0, helcimToken: TOKEN, ipAddress: "203.0.113.5" });
    expect(calls.find((c) => c.path === "/payment/refund")!.body).toMatchObject({ amount: 61.8 });
    d = (await getSale(kit.A, saleId))!;
    p = d.payments[0]!;
    expect([p.refundedCents, p.surchargeRefundedCents, p.status, d.sale.status]).toEqual([10_300, 300, "refunded", "refunded"]);
  });

  it("gives the fee's share back with store credit too", async () => {
    const saleId = await paidByCard();
    const p = (await getSale(kit.A, saleId))!.payments[0]!;
    await refundToStoreCredit({ businessId: kit.A, paymentId: p.id, amountCents: 5_000, reason: null, actorUserId: userId });
    const ledger = await withTenant(kit.A, (tx) => tx.select().from(schema.storeCreditLedger).where(eq(schema.storeCreditLedger.paymentId, p.id)));
    expect(ledger.map((l) => [l.deltaCents, l.surchargeCents])).toEqual([[5_150, 150]]);
    const after = (await getSale(kit.A, saleId))!.payments[0]!;
    expect(after.surchargeRefundedCents).toBe(150);
  });

  it("keeps the fee out of commission, tips and refund clawbacks", async () => {
    const saleId = await paidByCard();
    const { sale, payments } = (await getSale(kit.A, saleId))!;
    fakeHelcim();
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: payments[0]!.id, amountCents: 2_000, reason: null, actorUserId: userId, taxRateBps: 0, helcimToken: TOKEN, ipAddress: "203.0.113.5" });
    const today = instantToISODate(new Date(), business.timezone);
    const rows = (await buildPayrollLines(business, { start: today, end: today })).filter((l) => l.saleNumber === sale.number);
    // The stylist is paid on the $100 service, all of it by card; the $20 refund takes back $20, not the $20.60 that went back to the card.
    expect(rows.map((r) => [r.name.replace(/^Refund · /, "refund "), r.amtPaidCents, r.cardCents, r.cashCents || 0])).toEqual([
      ["Color", 10_000, 10_000, 0],
      ["refund Color", -2_000, -2_000, 0],
    ]);
  });

  it("reports the fee apart from Sales and Refunds", async () => {
    const before = new Date(Date.now() - 60_000);
    const saleId = await paidByCard();
    const p = (await getSale(kit.A, saleId))!.payments[0]!;
    const report = () => salesReport(kit.A, before, new Date(Date.now() + 60_000));
    const r0 = await report();
    fakeHelcim();
    await refundPayment({ businessId: kit.A, accountId: null, paymentId: p.id, amountCents: 5_000, reason: null, actorUserId: userId, taxRateBps: 0, helcimToken: TOKEN, ipAddress: "203.0.113.5" });
    const r = await report();
    const mine = r.sales.find((s) => s.id === saleId)!;
    expect([mine.totalCents - mine.tipCents - mine.cardFeeCents, mine.cardFeeCents]).toEqual([10_000, 300]);
    // This refund: $50 of sales, and $1.50 of card fee reported with the fees.
    expect([r.refundsCents - r0.refundsCents, r.cardFeeRefundedCents - r0.cardFeeRefundedCents]).toEqual([5_000, 150]);
  });

  it("adds no fee where the processor can't tell a debit card, when debit is exempt", async () => {
    await db.update(schema.businesses).set({ cardFeeDebitExempt: true }).where(eq(schema.businesses.id, kit.A));
    try {
      const saleId = await paidByCard();
      expect(calls.find((c) => c.path === "/payment/purchase")!.body).toMatchObject({ amount: 100 });
      const d = (await getSale(kit.A, saleId))!;
      expect([d.sale.cardFeeCents, d.sale.totalCents, d.payments[0]!.surchargeCents]).toEqual([0, 10_000, 0]);
    } finally {
      await db.update(schema.businesses).set({ cardFeeDebitExempt: false }).where(eq(schema.businesses.id, kit.A));
    }
  });

  it("turns on Google Pay in Helcim's card form for payments, not for card holds", async () => {
    fakeHelcim();
    const b = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    await openHelcimCheckout(b, { purpose: "deposit", meta: { kind: "deposit" }, amountCents: 5_000 });
    await openHelcimCheckout(b, { purpose: "card", meta: { kind: "card" }, amountCents: 0 });
    const inits = calls.filter((c) => c.path === "/helcim-pay/initialize").map((c) => c.body);
    expect(inits[0]).toMatchObject({ paymentType: "purchase", digitalWallet: { "google-pay": 1 } });
    expect(inits[1]).not.toHaveProperty("digitalWallet");
  });
});
