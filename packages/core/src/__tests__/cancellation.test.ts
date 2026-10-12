import { describe, expect, it } from "vitest";
import { isInsideCancelWindow, lateCancelFee, lateCancelFeeLabel } from "../cancellation";

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
