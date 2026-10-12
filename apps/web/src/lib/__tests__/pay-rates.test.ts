import { describe, expect, it } from "vitest";
import { changesWithin, describeRate, rateAsOf, rateDiff, type PayRateRow } from "../pay-rates";

const base: PayRateRow = { effectiveFrom: "2026-01-01", payType: "commission", mainCommissionBps: 4000, productCommissionBps: 500, ccTipFeeBps: 300, hourlyRateCents: 0, salaryPerPeriodCents: 0, overtimeOverride: null, taxDeductionCents: null, taxDeductionBps: null };
const raise: PayRateRow = { ...base, effectiveFrom: "2026-10-01", mainCommissionBps: 4500 };
const future: PayRateRow = { ...base, effectiveFrom: "2027-01-01", mainCommissionBps: 5000 };

describe("rateAsOf", () => {
  it("picks the latest row that has started", () => {
    expect(rateAsOf([base, raise, future], "2026-09-30")?.mainCommissionBps).toBe(4000);
    expect(rateAsOf([base, raise, future], "2026-10-01")?.mainCommissionBps).toBe(4500);
    expect(rateAsOf([base, raise, future], "2026-12-31")?.mainCommissionBps).toBe(4500);
    expect(rateAsOf([raise], "2026-01-15")).toBeNull();
  });
});

describe("changesWithin", () => {
  it("lists changes that start inside the period, ignoring the first-ever row", () => {
    expect(changesWithin([base, raise, future], "2026-09-16", "2026-10-15").map((r) => r.effectiveFrom)).toEqual(["2026-10-01"]);
    expect(changesWithin([base, raise], "2026-01-01", "2026-01-31")).toEqual([]);
  });
});

describe("describeRate / rateDiff", () => {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  it("reads naturally and only lists what changed", () => {
    expect(describeRate(raise, money)).toBe("Commission · 45% service · 5% product · 3% card-tip fee");
    expect(describeRate({ ...base, payType: "hourly", hourlyRateCents: 2000, mainCommissionBps: 0, productCommissionBps: 0, ccTipFeeBps: 0 }, money)).toBe("Hourly · $20.00/h");
    expect(rateDiff(base, raise)).toEqual({ mainCommissionBps: { from: 4000, to: 4500 } });
  });
});
