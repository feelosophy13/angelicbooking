import { describe, expect, it } from "vitest";
import { CARD_FEE_METHODS, computeHours, computePayroll, rateLabel, splitTips, tipsPerPayment, type PayrollEmployee, type PayrollLine } from "../payroll";

const base = (over: Partial<PayrollEmployee>): PayrollEmployee => ({
  staffId: "s",
  name: "X",
  position: "Lash Artist",
  payType: "commission",
  mainCommissionBps: 4000,
  productCommissionBps: 500,
  ccTipFeeBps: 300,
  hourlyRateCents: 0,
  salaryPerPeriodCents: 0,
  overtimeOverride: null,
  taxDeductionCents: null,
  taxDeductionBps: null,
  ...over,
});
const line = (over: Partial<PayrollLine>): PayrollLine => ({
  staffId: "s",
  kind: "service",
  refunded: false,
  date: "2026-07-14",
  customer: "C",
  name: "Lash full set",
  checkoutBy: null,
  saleNumber: 1,
  cashCents: 0,
  cardCents: 0,
  cashTipCents: 0,
  cardTipCents: 0,
  discountCents: 0,
  amtPaidCents: 0,
  ...over,
});

describe("commission provider (Raina example from the salon's sheet)", () => {
  it("reproduces Total 1099 to the cent", () => {
    // $10,322.47 main revenue, $1,152.70 tips (all card), $316.20 product sales, membership earns 0
    const lines: PayrollLine[] = [
      line({ amtPaidCents: 1_032_247 + 115_270, cardTipCents: 115_270, cardCents: 1_032_247 + 115_270 }),
      line({ kind: "product", name: "Lash serum", amtPaidCents: 31_620 }),
      line({ kind: "membership", name: "Booking Pass Membership", amtPaidCents: 9_900 }),
      line({ refunded: true, amtPaidCents: 20_000 }),
    ];
    const r = computePayroll({ employees: [base({ name: "Raina" })], lines, hours: [], adjustments: [], overtime: false });
    const e = r.employees[0]!;
    expect(e.mainRevenueCents).toBe(1_032_247);
    expect(e.mainCommissionCents).toBe(412_899);
    expect(e.cardTipsCents).toBe(115_270);
    expect(e.ccTipFeeCents).toBe(3_458);
    expect(e.productSalesCents).toBe(31_620);
    expect(e.productCommissionCents).toBe(1_581);
    expect(e.totalCents).toBe(526_292);
    expect(e.refundedRows).toHaveLength(1);
    expect(e.serviceRevenueCents).toBe(1_032_247);
    expect(e.serviceProfitCents).toBe(1_032_247 - 412_899 - 1_581);
  });
});

describe("hourly staff (Maria and Dasia examples)", () => {
  it("pays straight time with overtime off and tax left at zero", () => {
    // 30.05 hrs × $16 = $480.80
    const hours = [
      { staffId: "s", date: "2026-07-13", minutes: 1803 }, // 30.05h total across days
    ];
    const r = computePayroll({ employees: [base({ payType: "hourly", hourlyRateCents: 1600, mainCommissionBps: 0, position: "Esthetician" })], lines: [], hours, adjustments: [], overtime: false });
    expect(r.employees[0]!.wageCents).toBe(48_080);
    expect(r.employees[0]!.totalCents).toBe(48_080);
  });
  it("adds tips net of card fee, product commission, adjustments, minus tax", () => {
    // Dasia: pay 197.55 + tips 200.79 net + 11.75 product + 142.90 training − 48.30 tax = 504.69
    const lines: PayrollLine[] = [
      line({ amtPaidCents: 10_000 + 20_700, cardTipCents: 20_700 }), // 207.00 card tips → fee 6.21 → 200.79
      line({ kind: "product", name: "Serum", amtPaidCents: 23_500 }), // 5% = 11.75
    ];
    const r = computePayroll({
      employees: [base({ payType: "hourly", hourlyRateCents: 1500, mainCommissionBps: 0, position: "Esthetician", taxDeductionCents: 4_830 })],
      lines,
      hours: [{ staffId: "s", date: "2026-07-14", minutes: 790.2 }], // 13.17h × $15 = 197.55
      adjustments: [{ staffId: "s", label: "Missed Pay from Training", amountCents: 14_290 }],
      overtime: false,
    });
    const e = r.employees[0]!;
    expect(e.wageCents).toBe(19_755);
    expect(e.cardTipsCents - e.ccTipFeeCents).toBe(20_079);
    expect(e.productCommissionCents).toBe(1_175);
    expect(e.taxCents).toBe(4_830);
    expect(e.totalCents).toBe(50_469);
  });
  it("buckets overtime per workweek when enabled", () => {
    const h = computeHours(
      [
        { staffId: "s", date: "2026-07-13", minutes: 600 }, // Mon
        { staffId: "s", date: "2026-07-14", minutes: 600 },
        { staffId: "s", date: "2026-07-15", minutes: 600 },
        { staffId: "s", date: "2026-07-16", minutes: 600 },
        { staffId: "s", date: "2026-07-17", minutes: 300 }, // 45h this week
        { staffId: "s", date: "2026-07-20", minutes: 480 }, // next week
      ],
      1,
      true,
    );
    expect(h.weeks.map((w) => w.overtimeMinutes)).toEqual([300, 0]);
    expect(h.regularMinutes).toBe(2400 + 480);
  });
});

describe("salary and non-revenue positions", () => {
  it("pays the flat amount and zeroes revenue for receptionists", () => {
    const lines = [line({ kind: "product", name: "Retail", amtPaidCents: 10_000 })];
    const r = computePayroll({ employees: [base({ payType: "salary", salaryPerPeriodCents: 211_500, mainCommissionBps: 0, position: "Receptionist" })], lines, hours: [], adjustments: [], overtime: true });
    const e = r.employees[0]!;
    expect(e.wageCents).toBe(211_500);
    expect(e.productCommissionCents).toBe(500);
    expect(e.totalCents).toBe(212_000);
    expect(e.serviceRevenueCents).toBe(0);
    expect(e.serviceProfitCents).toBe(0);
  });
  it("reports lines for staff missing from the config", () => {
    const r = computePayroll({ employees: [], lines: [line({ staffId: "ghost" })], hours: [], adjustments: [], overtime: false });
    expect(r.unmatchedStaffIds).toEqual(["ghost"]);
  });
});

describe("combined pay models", () => {
  it("hourly plus service commission: wage and commission both paid, withholding on both", () => {
    // 10h × $20 = $200 wage; $500 of services × 15% = $75 commission; 10% tax on $275 = $27.50
    const lines = [line({ amtPaidCents: 50_000 })];
    const r = computePayroll({ employees: [base({ payType: "hourly", hourlyRateCents: 2000, mainCommissionBps: 1500, taxDeductionBps: 1000 })], lines, hours: [{ staffId: "s", date: "2026-07-14", minutes: 600 }], adjustments: [], overtime: false });
    const e = r.employees[0]!;
    expect(e.wageCents).toBe(20_000);
    expect(e.mainCommissionCents).toBe(7_500);
    expect(e.taxCents).toBe(2_750);
    expect(e.totalCents).toBe(20_000 + 7_500 - 2_750);
  });
  it("salary plus service commission", () => {
    const lines = [line({ amtPaidCents: 100_000 })];
    const r = computePayroll({ employees: [base({ payType: "salary", salaryPerPeriodCents: 150_000, mainCommissionBps: 1000 })], lines, hours: [], adjustments: [], overtime: false });
    expect(r.employees[0]!.totalCents).toBe(150_000 + 10_000);
    expect(r.employees[0]!.overtimeApplied).toBe(false);
  });
  it("commission plus hourly base (1099 contractor with a guaranteed rate)", () => {
    const lines = [line({ amtPaidCents: 100_000 })];
    const r = computePayroll({ employees: [base({ payType: "commission", mainCommissionBps: 4000, hourlyRateCents: 1000 })], lines, hours: [{ staffId: "s", date: "2026-07-14", minutes: 480 }], adjustments: [], overtime: false });
    const e = r.employees[0]!;
    expect(e.wageCents).toBe(8_000);
    expect(e.totalCents).toBe(40_000 + 8_000);
    expect(e.taxCents).toBe(0);
  });
  it("labels combined rates", () => {
    expect(rateLabel(base({ payType: "hourly", hourlyRateCents: 1800, mainCommissionBps: 1500 }))).toBe("$18.00/hr + 15%");
    expect(rateLabel(base({ payType: "hourly", hourlyRateCents: 1800, mainCommissionBps: 0 }))).toBe("$18.00/hr");
    expect(rateLabel(base({ payType: "commission", mainCommissionBps: 4000 }))).toBe("40%");
  });
});

describe("splitTips", () => {
  it("sends a tip marked cash or card where it was marked, whatever the payment mix", () => {
    expect(splitTips([{ amountCents: 1500, method: "cash" }], 0)).toEqual({ cashCents: 1500, cardCents: 0, totalCents: 1500 });
    expect(splitTips([{ amountCents: 1500, method: "card" }], 1)).toEqual({ cashCents: 0, cardCents: 1500, totalCents: 1500 });
    expect(splitTips([{ amountCents: 1000, method: "cash" }, { amountCents: 500, method: "card" }], 0.5)).toEqual({ cashCents: 1000, cardCents: 500, totalCents: 1500 });
  });
  it("splits an unmarked tip by the share paid without a card, and the parts add back exactly", () => {
    expect(splitTips([{ amountCents: 1000, method: null }], 0.25)).toEqual({ cashCents: 250, cardCents: 750, totalCents: 1000 });
    const r = splitTips([{ amountCents: 333, method: null }, { amountCents: 100, method: "cash" }], 1 / 3);
    expect(r.cashCents + r.cardCents).toBe(r.totalCents);
    expect(r.totalCents).toBe(433);
  });
  it("ignores empty tips and clamps a nonsense share", () => {
    expect(splitTips([{ amountCents: 0, method: "cash" }], 0.5).totalCents).toBe(0);
    expect(splitTips([{ amountCents: 100, method: null }], 7).cashCents).toBe(100);
    expect(splitTips([{ amountCents: 100, method: null }], -1).cashCents).toBe(0);
  });
  it("charges the card fee only for real card payments, not gift cards, store credit, points or cash", () => {
    for (const m of ["card", "card_on_file", "terminal"]) expect(CARD_FEE_METHODS.has(m)).toBe(true);
    for (const m of ["cash", "other", "gift_card", "store_credit", "loyalty"]) expect(CARD_FEE_METHODS.has(m)).toBe(false);
  });
});

describe("tipsPerPayment", () => {
  const pays = [{ id: "card1", method: "card", amountCents: 8000 }, { id: "cash1", method: "cash", amountCents: 2000 }, { id: "gc1", method: "gift_card", amountCents: 2000 }];
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  it("puts a cash tip on the non-card payments and a card tip on the card payment", () => {
    const r = tipsPerPayment([{ amountCents: 1000, method: "cash" }, { amountCents: 500, method: "card" }], pays);
    expect(r.card1).toBe(500);
    expect((r.cash1 ?? 0) + (r.gc1 ?? 0)).toBe(1000);
    expect(r.cash1).toBe(500); // equal weights
    expect(sum(r)).toBe(1500);
  });
  it("spreads an unmarked tip across every payment by amount, adding back exactly", () => {
    const r = tipsPerPayment([{ amountCents: 1001, method: null }], pays);
    expect(sum(r)).toBe(1001);
    expect(r.card1 ?? 0).toBeGreaterThan(r.cash1 ?? 0);
  });
  it("falls back to all payments when none is of the right kind, and copes with no payments", () => {
    expect(tipsPerPayment([{ amountCents: 700, method: "card" }], [{ id: "c", method: "cash", amountCents: 5000 }])).toEqual({ c: 700 });
    expect(tipsPerPayment([{ amountCents: 700, method: "cash" }], [])).toEqual({});
  });
});

describe("overtime across a pay-period boundary", () => {
  it("counts the start of the workweek toward 40 hours without paying it twice", async () => {
    const { computeHours } = await import("../payroll");
    // Mon 2026-10-12 … Thu: 8 h a day in the previous period; Fri and Sat (the new period starts Fri the 16th): 8 h each.
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    const entries = days.map((date) => ({ staffId: "s", date, minutes: 480 }));
    const h = computeHours(entries, 1, true, 40 * 60, "2026-10-16");
    expect(h.byDate.map((d) => d.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect([h.totalMinutes, h.regularMinutes, h.overtimeMinutes]).toEqual([960, 480, 480]);
    // Without the earlier days the same two shifts would look like 16 h with no overtime.
    expect(computeHours(entries.slice(4), 1, true).overtimeMinutes).toBe(0);
  });
});

describe("daily overtime (California) and commission in the overtime rate", () => {
  // 2026-10-05 is a Monday; weekStart 1 = Monday.
  const day = (d: number, hours: number) => ({ staffId: "s", date: `2026-10-${String(d).padStart(2, "0")}`, minutes: hours * 60 });

  it("pays over 8 h a day as overtime and over 12 h as double time", () => {
    const h = computeHours([day(5, 13), day(6, 6)], 1, true, 40 * 60, undefined, "daily");
    expect([h.regularMinutes / 60, h.overtimeMinutes / 60, h.doubleMinutes / 60]).toEqual([14, 4, 1]);
  });

  it("counts only regular hours toward the 40 h week, and the seventh day in a row is all overtime or double", () => {
    // Six 9-hour days: 8 regular + 1 overtime each → 48 regular hours, 8 of them past 40 → weekly overtime.
    const six = [5, 6, 7, 8, 9, 10].map((d) => day(d, 9));
    const h = computeHours([...six, day(11, 10)], 1, true, 40 * 60, undefined, "daily");
    // Regular 40; overtime 6 (daily) + 8 (weekly) + 8 (7th day, first 8 h); double 2 (7th day past 8 h).
    expect([h.regularMinutes / 60, h.overtimeMinutes / 60, h.doubleMinutes / 60]).toEqual([40, 22, 2]);
  });

  it("leaves the weekly rule as it was: 1.5× past 40 h, no daily line", () => {
    const h = computeHours([day(5, 13), day(6, 6)], 1, true);
    expect([h.regularMinutes / 60, h.overtimeMinutes / 60, h.doubleMinutes]).toEqual([19, 0, 0]);
  });

  it("adds half the commission per hour to each overtime hour (FLSA regular rate)", () => {
    // 50 h at $20 with $1,000 commission on $2,500 of services: commission per hour $20, so 10 overtime hours add 10 × $10 = $100.
    const hours = [5, 6, 7, 8, 9].map((d) => day(d, 10));
    const emp = base({ payType: "hourly", hourlyRateCents: 2000, mainCommissionBps: 4000, overtimeOverride: null });
    const r = computePayroll({ employees: [emp], lines: [line({ amtPaidCents: 250_000 })], hours, adjustments: [], overtime: true });
    const e = r.employees[0]!;
    expect(e.mainCommissionCents).toBe(100_000);
    expect(e.overtimeOnCommissionCents).toBe(10_000);
    // 40 × $20 + 10 × $30 + $100
    expect(e.wageCents).toBe(80_000 + 30_000 + 10_000);
  });

  it("adds nothing when overtime is off", () => {
    const hours = [5, 6, 7, 8, 9].map((d) => day(d, 10));
    const emp = base({ payType: "hourly", hourlyRateCents: 2000, mainCommissionBps: 4000 });
    const e = computePayroll({ employees: [emp], lines: [line({ amtPaidCents: 250_000 })], hours, adjustments: [], overtime: false }).employees[0]!;
    expect([e.overtimeOnCommissionCents, e.wageCents]).toEqual([0, 100_000]);
  });
});
