import { describe, expect, it } from "vitest";
import { addMembershipPeriod, periodLabel, periodNoun, renewedCredits } from "../membership";

const d = (s: string) => new Date(s);

describe("addMembershipPeriod", () => {
  it("adds calendar months and clamps to the last day", () => {
    expect(addMembershipPeriod(d("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMembershipPeriod(d("2026-03-31T10:00:00Z"), "month", 1).toISOString()).toBe("2026-04-30T10:00:00.000Z");
    expect(addMembershipPeriod(d("2026-01-15T10:00:00Z"), "month", 3).toISOString()).toBe("2026-04-15T10:00:00.000Z");
  });
  it("adds weeks and years", () => {
    expect(addMembershipPeriod(d("2026-01-01T00:00:00Z"), "week", 2).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(addMembershipPeriod(d("2024-02-29T00:00:00Z"), "year").toISOString()).toBe("2025-02-28T00:00:00.000Z");
  });
  it("can add several periods at once", () => {
    expect(addMembershipPeriod(d("2026-01-01T00:00:00Z"), "month", 1, 6).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("labels", () => {
  it("reads naturally", () => {
    expect(periodNoun("month")).toBe("month");
    expect(periodNoun("week", 2)).toBe("2 weeks");
    expect(periodLabel("month")).toBe("per month");
    expect(periodLabel("month", 3)).toBe("every 3 months");
    expect(periodLabel("year")).toBe("per year");
  });
});

describe("renewedCredits", () => {
  it("adds the new sessions and carries over up to the cap", () => {
    expect(renewedCredits(3, 2, 0)).toBe(2);
    expect(renewedCredits(3, 2, 1)).toBe(3);
    expect(renewedCredits(0, 2, 5)).toBe(2);
    expect(renewedCredits(-1, 2, 5)).toBe(2);
  });
});
