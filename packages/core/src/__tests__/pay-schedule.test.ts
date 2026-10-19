import { describe, expect, it } from "vitest";
import { isScheduledPeriod, nextPeriod, periodContaining, payPeriodLabel, previousPeriod, proratedSalary, rangesOverlap, salaryShare, type PaySchedule } from "../pay-schedule";

const biweekly: PaySchedule = { frequency: "biweekly", anchor: "2026-09-21" };
const weekly: PaySchedule = { frequency: "weekly", anchor: "2026-09-21" };
const semi: PaySchedule = { frequency: "semimonthly", anchor: null };
const monthly: PaySchedule = { frequency: "monthly", anchor: null };

describe("periodContaining", () => {
  it("biweekly from the anchor, before and after it", () => {
    expect(periodContaining(biweekly, "2026-10-19")).toEqual({ start: "2026-10-19", end: "2026-11-01" });
    expect(periodContaining(biweekly, "2026-10-04")).toEqual({ start: "2026-09-21", end: "2026-10-04" });
    expect(periodContaining(biweekly, "2026-09-20")).toEqual({ start: "2026-09-07", end: "2026-09-20" });
    expect(periodContaining(biweekly, "2026-01-01")).toEqual({ start: "2025-12-29", end: "2026-01-11" });
  });
  it("weekly", () => {
    expect(periodContaining(weekly, "2026-09-27")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    expect(periodContaining(weekly, "2026-09-28")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("semimonthly halves, including February and 31-day months", () => {
    expect(periodContaining(semi, "2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(periodContaining(semi, "2026-10-16")).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(periodContaining(semi, "2028-02-20")).toEqual({ start: "2028-02-16", end: "2028-02-29" });
  });
  it("monthly", () => {
    expect(periodContaining(monthly, "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("walks forward and back without gaps or overlaps", () => {
    for (const s of [biweekly, weekly, semi, monthly]) {
      let p = periodContaining(s, "2026-06-15");
      for (let i = 0; i < 30; i++) {
        const n = nextPeriod(s, p);
        expect(n.start > p.end).toBe(true);
        expect(previousPeriod(s, n)).toEqual(p);
        expect(isScheduledPeriod(s, n)).toBe(true);
        p = n;
      }
    }
    expect(nextPeriod(semi, { start: "2026-12-16", end: "2026-12-31" })).toEqual({ start: "2027-01-01", end: "2027-01-15" });
    expect(isScheduledPeriod(biweekly, { start: "2026-09-21", end: "2026-09-27" })).toBe(false);
  });
});

describe("salary proration", () => {
  it("a scheduled period pays the whole salary", () => {
    expect(salaryShare(biweekly, { start: "2026-09-21", end: "2026-10-04" }).share).toBe(1);
    expect(proratedSalary(200_000, 1)).toBe(200_000);
  });
  it("half a period pays half; a run across two periods adds the shares", () => {
    expect(salaryShare(biweekly, { start: "2026-09-21", end: "2026-09-27" }).share).toBe(0.5);
    const r = salaryShare(biweekly, { start: "2026-09-28", end: "2026-10-11" });
    expect(r.share).toBe(1);
    expect(r.pieces.map((p) => [p.coveredDays, p.periodDays])).toEqual([[7, 14], [7, 14]]);
    expect(salaryShare(biweekly, { start: "2026-09-21", end: "2026-10-18" }).share).toBe(2);
  });
  it("semimonthly halves are weighted by their own length, so a month pays exactly two periods", () => {
    const r = salaryShare(semi, { start: "2026-10-01", end: "2026-10-31" });
    expect(r.share).toBe(2);
    expect(proratedSalary(150_000, salaryShare(semi, { start: "2026-10-16", end: "2026-10-23" }).share)).toBe(75_000); // 8 of 16 days
  });
  it("rounds to the cent", () => {
    expect(proratedSalary(100_001, 0.5)).toBe(50_001);
  });
});

describe("overlap and label", () => {
  it("rangesOverlap is inclusive", () => {
    expect(rangesOverlap({ start: "2026-09-21", end: "2026-10-04" }, { start: "2026-10-04", end: "2026-10-17" })).toBe(true);
    expect(rangesOverlap({ start: "2026-09-21", end: "2026-10-04" }, { start: "2026-10-05", end: "2026-10-18" })).toBe(false);
  });
  it("payPeriodLabel reads like the owner's sheets", () => {
    expect(payPeriodLabel({ start: "2026-07-12", end: "2026-07-25" })).toBe("July 12 2026 - July 25 2026");
  });
});

describe("salary in computePayroll", () => {
  it("is prorated by salaryShare and flat when no share is given", async () => {
    const { computePayroll } = await import("../payroll");
    const emp = { staffId: "s", name: "B", position: "Receptionist", payType: "salary" as const, mainCommissionBps: 0, productCommissionBps: 500, ccTipFeeBps: 300, hourlyRateCents: 0, salaryPerPeriodCents: 200_000, overtimeOverride: null, taxDeductionCents: null, taxDeductionBps: null };
    expect(computePayroll({ employees: [emp], lines: [], hours: [], adjustments: [], overtime: false }).employees[0]!.wageCents).toBe(200_000);
    expect(computePayroll({ employees: [emp], lines: [], hours: [], adjustments: [], overtime: false, salaryShare: 0.5 }).employees[0]!.wageCents).toBe(100_000);
    expect(computePayroll({ employees: [emp], lines: [], hours: [], adjustments: [], overtime: false, salaryShare: 2 }).employees[0]!.totalCents).toBe(400_000);
  });
});
