import { describe, expect, it } from "vitest";
import { isInsideCancelWindow, lateCancelFee, lateCancelFeeLabel, policyFeeCheck } from "../cancellation";

describe("isInsideCancelWindow", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("is inside when the visit is closer than the window", () => {
    expect(isInsideCancelWindow(new Date("2026-10-12T11:00:00Z"), 24, now)).toBe(true);
    expect(isInsideCancelWindow(new Date("2026-10-12T13:00:00Z"), 24, now)).toBe(false);
    expect(isInsideCancelWindow(new Date("2026-10-10T13:00:00Z"), 24, now)).toBe(true);
    expect(isInsideCancelWindow(new Date("2026-10-11T12:30:00Z"), 0, now)).toBe(false);
  });
});

describe("lateCancelFee", () => {
  it("flat fee, deposit counting toward it", () => {
    expect(lateCancelFee({ feeType: "flat", feeValue: 2500, deposit: "toward" }, 16000, 5000)).toEqual({ feeCents: 2500, depositCoversCents: 2500, chargeCents: 0 });
    expect(lateCancelFee({ feeType: "flat", feeValue: 8000, deposit: "toward" }, 16000, 5000)).toEqual({ feeCents: 8000, depositCoversCents: 5000, chargeCents: 3000 });
  });
  it("percent fee, deposit kept on top", () => {
    expect(lateCancelFee({ feeType: "percent", feeValue: 5000, deposit: "extra" }, 16000, 5000)).toEqual({ feeCents: 8000, depositCoversCents: 0, chargeCents: 8000 });
  });
  it("no policy means nothing owed", () => {
    expect(lateCancelFee({ feeType: "none", feeValue: 0, deposit: "toward" }, 16000, 5000).feeCents).toBe(0);
  });
  it("labels", () => {
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(lateCancelFeeLabel({ feeType: "flat", feeValue: 2500, deposit: "toward" }, money)).toBe("$25.00");
    expect(lateCancelFeeLabel({ feeType: "percent", feeValue: 5000, deposit: "toward" }, money)).toBe("50% of the booked services");
    expect(lateCancelFeeLabel({ feeType: "none", feeValue: 0, deposit: "toward" }, money)).toBeNull();
  });
});

describe("policyFeeCheck", () => {
  const flat25 = { feeType: "flat" as const, feeValue: 2500, deposit: "toward" as const };
  it("flags a sentence that quotes a different fee", () => {
    const r = policyFeeCheck("Please arrive 5 minutes early. Cancellations inside 24 hours may be charged 50% of the service.", flat25);
    expect(r.conflicts).toEqual(["Cancellations inside 24 hours may be charged 50% of the service."]);
    expect(r.repeats).toEqual([]);
  });
  it("recognises a sentence that repeats the same fee", () => {
    expect(policyFeeCheck("Late cancellations are charged $25.", flat25).repeats).toHaveLength(1);
    expect(policyFeeCheck("A fee of $25.00 applies to late cancellations.", flat25).conflicts).toEqual([]);
    expect(policyFeeCheck("Late cancellations are charged 50%.", { feeType: "percent", feeValue: 5000, deposit: "toward" }).repeats).toHaveLength(1);
  });
  it("ignores unrelated amounts and sentences without an amount", () => {
    expect(policyFeeCheck("Gift cards over $100 never expire. Be on time.", flat25)).toEqual({ repeats: [], conflicts: [] });
    expect(policyFeeCheck("Cancellations inside 24 hours may be charged.", flat25)).toEqual({ repeats: [], conflicts: [] });
    expect(policyFeeCheck("Cancellations cost $25.", { feeType: "none", feeValue: 0, deposit: "toward" })).toEqual({ repeats: [], conflicts: [] });
  });
});
