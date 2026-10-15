import { describe, expect, it } from "vitest";
import { pricingChanges, waiting, waitingShort } from "../audit-text";

describe("pricingChanges", () => {
  it("lists changed default prices", () => {
    expect(pricingChanges("pricing.default.update", { before: { baseCents: 2900, platformFeeBps: 0 }, after: { baseCents: 1900, platformFeeBps: 50 } })).toEqual(["Base plan $29.00 → $19.00", "Platform fee 0% → 0.5%"]);
  });
  it("shows a cleared override as default", () => {
    expect(pricingChanges("pricing.business.update", { before: { overrides: { baseCents: 1900 } }, after: { overrides: { baseCents: null } } })).toEqual(["Base plan $19.00 → default"]);
  });
  it("ignores other actions", () => {
    expect(pricingChanges("tenant.suspend", {})).toEqual([]);
  });
});

describe("waiting", () => {
  it("reads minutes as a person would", () => {
    expect(waiting(12)).toBe("12 min");
    expect(waiting(90)).toBe("1 hour 30 min");
    expect(waiting(5496)).toBe("3 days 19 hours");
    expect(waitingShort(5496)).toBe("3d 19h");
    expect(waitingShort(12)).toBe("12m");
  });
});
