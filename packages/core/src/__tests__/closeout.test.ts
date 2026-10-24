import { describe, expect, it } from "vitest";
import { closeNeedsNote, closingReport, countDenominations, drawerFlows, expectedCash, overShort, OVER_SHORT_NOTE_CENTS, type CloseoutTicket } from "../closeout";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, can } from "../permissions";

describe("expected cash", () => {
  it("is float + cash sales − cash refunds − cash tips paid out + pay-ins − payouts", () => {
    expect(expectedCash({ openingFloatCents: 20000, cashSalesCents: 45000, cashRefundsCents: 3000, tipPayoutsCents: 4000, payInsCents: 5000, payoutsCents: 1200 })).toBe(20000 + 45000 - 3000 - 4000 + 5000 - 1200);
  });

  it("totals a drawer's payments, refunds and movements by kind", () => {
    const f = drawerFlows({
      openingFloatCents: 15000,
      payments: [{ amountCents: 6500 }, { amountCents: 12000 }],
      refunds: [{ amountCents: 2500 }],
      movements: [
        { kind: "pay_in", amountCents: 2000 },
        { kind: "payout", amountCents: 800 },
        { kind: "payout", amountCents: 200 },
        { kind: "tip_payout", amountCents: 1500 },
      ],
    });
    expect(f).toEqual({ openingFloatCents: 15000, cashSalesCents: 18500, cashRefundsCents: 2500, tipPayoutsCents: 1500, payInsCents: 2000, payoutsCents: 1000 });
    expect(expectedCash(f)).toBe(15000 + 18500 - 2500 - 1500 + 2000 - 1000);
  });

  it("an untouched drawer expects its float", () => {
    expect(expectedCash(drawerFlows({ openingFloatCents: 10000, payments: [], refunds: [], movements: [] }))).toBe(10000);
  });
});

describe("counting and over/short", () => {
  it("adds up a count by denomination and ignores junk", () => {
    expect(countDenominations({ "10000": 1, "2000": 3, "500": 2, "100": 4, "25": 8, "10": 3, "5": 1, "1": 2 })).toBe(10000 + 6000 + 1000 + 400 + 200 + 30 + 5 + 2);
    expect(countDenominations({ "300": 4, "2000": -1, "500": 1.5, "100": 0 })).toBe(0);
  });

  it("is positive over, negative short", () => {
    expect(overShort(10250, 10000)).toBe(250);
    expect(overShort(9900, 10000)).toBe(-100);
  });

  it("needs a note only when off by more than the limit, either way", () => {
    expect(closeNeedsNote(0)).toBe(false);
    expect(closeNeedsNote(OVER_SHORT_NOTE_CENTS)).toBe(false);
    expect(closeNeedsNote(-OVER_SHORT_NOTE_CENTS)).toBe(false);
    expect(closeNeedsNote(OVER_SHORT_NOTE_CENTS + 1)).toBe(true);
    expect(closeNeedsNote(-(OVER_SHORT_NOTE_CENTS + 1))).toBe(true);
  });
});

describe("closing report", () => {
  const ticket = (over: Partial<CloseoutTicket>): CloseoutTicket => ({ saleId: "s", subtotalCents: 0, discountCents: 0, taxCents: 0, tipCents: 0, totalCents: 0, servicesCents: 0, productsCents: 0, tips: [], payments: [], ...over });

  const report = closingReport({
    payments: [
      { id: "p1", saleId: "s1", method: "cash", provider: "stripe", amountCents: 11000, appliedDeposit: false },
      { id: "p2", saleId: "s2", method: "card", provider: "stripe", amountCents: 8000, appliedDeposit: false },
      { id: "p3", saleId: "s2", method: "card", provider: "stripe", amountCents: 2000, appliedDeposit: true },
      { id: "p4", saleId: "s3", method: "terminal", provider: "helcim", amountCents: 15000, appliedDeposit: false },
      { id: "p5", saleId: "s3", method: "gift_card", provider: "stripe", amountCents: 5000, appliedDeposit: false },
      { id: "p6", saleId: "s4", method: "external_card", provider: "stripe", amountCents: 4000, appliedDeposit: false },
      { id: "p7", saleId: "s4", method: "store_credit", provider: "stripe", amountCents: 1000, appliedDeposit: false },
    ],
    refunds: [
      { method: "cash", provider: "stripe", amountCents: 3000 },
      { method: "card", provider: "stripe", amountCents: 1500 },
      { method: "terminal", provider: "helcim", amountCents: 500 },
    ],
    tickets: [
      // $100 service, $10 cash tip marked cash.
      ticket({ saleId: "s1", subtotalCents: 10000, totalCents: 11000, tipCents: 1000, servicesCents: 10000, tips: [{ amountCents: 1000, method: "cash" }], payments: [{ id: "p1", method: "cash", amountCents: 11000 }] }),
      // $80 service + $20 product, $10 off, $2 tax... tip unmarked, split over the card payments.
      ticket({ saleId: "s2", subtotalCents: 10000, discountCents: 1000, taxCents: 0, tipCents: 1000, totalCents: 10000, servicesCents: 8000, productsCents: 2000, tips: [{ amountCents: 1000, method: null }], payments: [{ id: "p2", method: "card", amountCents: 8000 }, { id: "p3", method: "card", amountCents: 2000 }] }),
      // A package sold, paid by card reader and a gift card; card tip goes to the reader.
      ticket({ saleId: "s3", subtotalCents: 18000, taxCents: 0, tipCents: 2000, totalCents: 20000, tips: [{ amountCents: 2000, method: "card" }], payments: [{ id: "p4", method: "terminal", amountCents: 15000 }, { id: "p5", method: "gift_card", amountCents: 5000 }] }),
    ],
    deposits: [
      { provider: "stripe", amountCents: 2500 },
      { provider: "helcim", amountCents: 3000 },
    ],
  });

  it("lists each method in the house order with taken, refunds and net", () => {
    expect(report.methods.map((m) => m.method)).toEqual(["cash", "card", "terminal", "external_card", "gift_card", "store_credit"]);
    const cash = report.methods.find((m) => m.method === "cash")!;
    expect(cash).toMatchObject({ count: 1, amountCents: 11000, refundsCents: 3000, netCents: 8000, tipsCents: 1000 });
    expect(report.methods.find((m) => m.method === "card")).toMatchObject({ count: 2, amountCents: 10000, refundsCents: 1500, netCents: 8500, tipsCents: 1000 });
    expect(report.methods.find((m) => m.method === "terminal")).toMatchObject({ amountCents: 15000, refundsCents: 500, tipsCents: 2000 });
    expect(report.methods.find((m) => m.method === "gift_card")!.tipsCents).toBe(0);
  });

  it("totals foot to the rows", () => {
    expect(report.totals).toEqual({ count: 7, amountCents: 46000, tipsCents: 4000, refundsCents: 5000, netCents: 41000 });
    expect(report.totals.netCents).toBe(report.methods.reduce((n, m) => n + m.netCents, 0));
  });

  it("card totals per processor leave out deposits applied today, add deposits taken online today, and take off card refunds", () => {
    expect(report.processors).toEqual([
      { provider: "helcim", chargedCents: 15000, depositsCents: 3000, refundsCents: 500, depositRefundsCents: 0, netCents: 17500 },
      { provider: "stripe", chargedCents: 8000, depositsCents: 2500, refundsCents: 1500, depositRefundsCents: 0, netCents: 9000 },
    ]);
  });

  it("takes deposits refunded before checkout off the processor's net", () => {
    const r = closingReport({ payments: [], refunds: [], tickets: [], deposits: [], depositRefunds: [{ provider: "stripe", amountCents: 2000 }] });
    expect(r.processors).toEqual([{ provider: "stripe", chargedCents: 0, depositsCents: 0, refundsCents: 0, depositRefundsCents: 2000, netCents: -2000 }]);
  });

  it("splits tickets into services, products and the rest, with discounts, tax and tips", () => {
    expect(report.tickets).toEqual({ count: 3, subtotalCents: 38000, servicesCents: 18000, productsCents: 2000, otherCents: 18000, discountCents: 1000, taxCents: 0, tipCents: 4000, totalCents: 41000 });
    expect(report.deposits).toEqual({ count: 2, amountCents: 5500 });
  });

  it("is empty on a day with nothing", () => {
    const r = closingReport({ payments: [], refunds: [], tickets: [], deposits: [] });
    expect(r.methods).toEqual([]);
    expect(r.processors).toEqual([]);
    expect(r.totals.netCents).toBe(0);
  });
});

describe("drawer permission", () => {
  it("front desk and manager open and close the drawer; a provider does not", () => {
    expect(can("front_desk", "drawer.manage")).toBe(true);
    expect(can("manager", "drawer.manage")).toBe(true);
    expect(can("owner", "drawer.manage")).toBe(true);
    expect(can("provider", "drawer.manage")).toBe(false);
  });

  it("the front desk closes the drawer without seeing reports (history and the closing report)", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.front_desk.has("reports.view")).toBe(false);
  });

  it("is on the Roles page", () => {
    expect(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.action))).toContain("drawer.manage");
  });
});
