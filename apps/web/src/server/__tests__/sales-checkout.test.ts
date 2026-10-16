/**
 * Integration test: a walk-in (products-only) ticket end to end: tax-exempt, tips with no service on the ticket, closing a $0 ticket, and a
 * cash payment. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { buildPayrollLines } from "@/server/payroll";
import { getSaleApi } from "@/server/api-v1";
import { addProductLine, addTipAfterPayment, completeNoCharge, getSale, openWalkInSale, recordManualPayment, removeLine, salesReport, setSaleNotes, setTaxExempt, setTips } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const TAX = 600; // 6%

describe.skipIf(!up)("checkout: a products-only ticket", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let productId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [p] = await tx.insert(schema.products).values({ businessId: kit.A, name: "Serum", priceCents: 6500, taxable: true, kind: "retail" }).returning({ id: schema.products.id });
      productId = p!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const open = () => openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd" });
  const base = () => ({ businessId: kit.A, actorUserId: userId, taxRateBps: TAX });

  it("adds a product, taxes it, and takes a tip for the person credited on the product", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId });
    let s = (await getSale(kit.A, saleId))!.sale;
    expect([s.subtotalCents, s.taxCents, s.totalCents]).toEqual([6500, 390, 6890]);
    // No service on the ticket: an unassigned tip follows the product's credit; a tip named for someone goes to them.
    await setTips({ businessId: kit.A, saleId, tips: [{ staffId: null, amountCents: 1300 }], taxRateBps: TAX });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale.tipCents).toBe(1300);
    expect(d.lines.filter((l) => l.kind === "tip").map((l) => [l.staffId, l.amountCents])).toEqual([[staffId, 1300]]);
    s = d.sale;
    expect(s.totalCents).toBe(8190);
  });

  it("can be marked tax exempt and back, and keeps a private note", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 2, staffId: null });
    await setTaxExempt({ ...base(), saleId, exempt: true });
    let s = (await getSale(kit.A, saleId))!.sale;
    expect([s.taxExempt, s.taxCents, s.totalCents]).toEqual([true, 0, 13000]);
    await setTaxExempt({ ...base(), saleId, exempt: false });
    s = (await getSale(kit.A, saleId))!.sale;
    expect([s.taxExempt, s.taxCents]).toEqual([false, 780]);
    await setSaleNotes({ businessId: kit.A, saleId, notes: "  gift for Maria ", actorUserId: userId });
    expect((await getSale(kit.A, saleId))!.sale.notes).toBe("gift for Maria");
  });

  it("closes a ticket with nothing due only when it has something on it", async () => {
    const empty = await open();
    await expect(completeNoCharge({ ...base(), saleId: empty })).rejects.toThrow(/Add something/);
    const owed = await open();
    await addProductLine({ ...base(), saleId: owed, productId, quantity: 1, staffId: null });
    await expect(completeNoCharge({ ...base(), saleId: owed })).rejects.toThrow(/amount due/);
  });

  it("closes on a cash payment, and a cash payment is capped at what is due", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId: null });
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: 10_000, note: "Received $100.00, change $31.10" });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale.status).toBe("paid");
    expect(d.payments.map((p) => p.amountCents)).toEqual([6890]);
    await expect(removeLine({ businessId: kit.A, saleId, lineId: d.lines[0]!.id, taxRateBps: TAX })).rejects.toThrow(/paid/);
  });

  it("keeps how a tip was handed over, and payroll splits cash and card tips by it (gift-card payments carry no card fee)", async () => {
    // Sale A: paid by card; $10 of the tip was left in cash and $5 on the card.
    const a = await open();
    await addProductLine({ ...base(), saleId: a, productId, quantity: 1, staffId });
    await setTips({ businessId: kit.A, saleId: a, tips: [{ staffId, amountCents: 1000, method: "cash" }, { staffId, amountCents: 500, method: "card" }], taxRateBps: TAX });
    const lines = (await getSale(kit.A, a))!.lines.filter((l) => l.kind === "tip");
    expect(lines.map((l) => [l.tipMethod, l.amountCents]).sort()).toEqual([["card", 500], ["cash", 1000]]);
    // Close both sales with direct payment rows so no card or Stripe is involved.
    const close = async (saleId: string, method: "card" | "gift_card") => {
      const sale = (await getSale(kit.A, saleId))!.sale;
      await withTenant(kit.A, async (tx) => {
        await tx.insert(schema.payments).values({ businessId: kit.A, saleId, method, status: "succeeded", amountCents: sale.totalCents });
        await tx.update(schema.sales).set({ status: "paid", paidCents: sale.totalCents, closedAt: new Date() }).where(eq(schema.sales.id, saleId));
      });
    };
    await close(a, "card");
    // Sale B: $20 tip, not marked, paid wholly with a gift card: no card was involved, so no card fee should apply to it.
    const b = await open();
    await addProductLine({ ...base(), saleId: b, productId, quantity: 1, staffId });
    await setTips({ businessId: kit.A, saleId: b, tips: [{ staffId, amountCents: 2000 }], taxRateBps: TAX });
    await close(b, "gift_card");
    // Sale C: $8 tip, not marked, paid by card: all card.
    const c = await open();
    await addProductLine({ ...base(), saleId: c, productId, quantity: 1, staffId });
    await setTips({ businessId: kit.A, saleId: c, tips: [{ staffId, amountCents: 800 }], taxRateBps: TAX });
    await close(c, "card");

    const biz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    const rows = (await buildPayrollLines(biz, { start: "2000-01-01", end: "2999-12-31" } as never)).filter((r) => r.staffId === staffId && r.name === "Tip");
    const tipRows = rows.map((r) => [r.cashTipCents, r.cardTipCents]);
    expect(tipRows).toContainEqual([1000, 500]); // A: as marked
    expect(tipRows).toContainEqual([2000, 0]); // B: gift card, no card fee
    expect(tipRows).toContainEqual([0, 800]); // C: card
  });

  it("adds a tip after the sale is paid: the sale stays paid, a cash payment and a tip line are added, and reports and the API read it back", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId });
    // Not paid yet: refused.
    await expect(addTipAfterPayment({ ...base(), saleId, staffId, amountCents: 500, method: "cash" })).rejects.toThrow(/paid in full/);
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: 10_000, note: null });
    let d = (await getSale(kit.A, saleId))!;
    expect(d.sale.status).toBe("paid");
    const before = d.sale.totalCents;
    await addTipAfterPayment({ ...base(), saleId, staffId, amountCents: 700, method: "cash" });
    d = (await getSale(kit.A, saleId))!;
    expect([d.sale.status, d.sale.tipCents, d.sale.totalCents, d.sale.paidCents]).toEqual(["paid", 700, before + 700, before + 700]);
    expect(d.lines.filter((l) => l.kind === "tip").map((l) => [l.tipMethod, l.amountCents, l.staffId])).toEqual([["cash", 700, staffId]]);
    expect(d.payments.map((p) => [p.method, p.amountCents, p.tipCents]).sort()).toEqual([["cash", before, 0], ["cash", 700, 700]].sort());
    // Errors: a card tip without a saved card, and no amount.
    await expect(addTipAfterPayment({ ...base(), saleId, staffId, amountCents: 700, method: "card" })).rejects.toThrow(/saved card|cash/);
    await expect(addTipAfterPayment({ ...base(), saleId, staffId, amountCents: 0, method: "cash" })).rejects.toThrow(/amount/);
    // The API names the cash tip and puts it on the cash payment that carried it.
    const api = (await getSaleApi(kit.A, saleId)) as unknown as { tip_cash_cents: number; tip_card_cents: number; lines: { kind: string; tip_method: string | null }[]; payments: { amount_cents: number; tip_cents: number }[] };
    expect([api.tip_cash_cents, api.tip_card_cents]).toEqual([700, 0]);
    expect(api.lines.filter((l) => l.kind === "tip").map((l) => l.tip_method)).toEqual(["cash"]);
    expect(api.payments.reduce((n, p) => n + p.tip_cents, 0)).toBe(700);
    // The report counts it as a cash tip.
    const r = await salesReport(kit.A, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000));
    expect(r.tipCashCents).toBeGreaterThanOrEqual(700);
    expect(r.tipCashCents + r.tipCardCents).toBe(r.sales.reduce((n, x) => n + x.tipCents, 0));
    expect(r.byMethod.reduce((n, m) => n + Number(m.tips), 0)).toBe(r.tipCashCents + r.tipCardCents);
  });
});
