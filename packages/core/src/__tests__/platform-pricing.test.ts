import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_BOOK, effectivePriceBook, monthlyBill } from "../platform-pricing";

const book = { ...DEFAULT_PRICE_BOOK, baseCents: 2900, includedLocations: 1, perLocationCents: 1500, includedStaff: 2, perStaffCents: 500, numberCents: 1500, smsIncluded: 100, smsUsageCents: 2 };

describe("monthlyBill", () => {
  it("charges only the base plan inside the included allowances", () => {
    const b = monthlyBill({ locations: 1, activeStaff: 2, hasNumber: false, smsLast30Days: 100 }, book);
    expect(b.totalCents).toBe(2900);
    expect(b.lines).toHaveLength(1);
  });

  it("adds extra locations, extra staff, the number fee and text overage", () => {
    const b = monthlyBill({ locations: 3, activeStaff: 7, hasNumber: true, smsLast30Days: 350 }, book);
    // 2900 + 2*1500 + 5*500 + 1500 + 250*2
    expect(b.totalCents).toBe(2900 + 3000 + 2500 + 1500 + 500);
    expect(b.lines.map((l) => l.label)).toEqual(["Base plan", "Extra locations", "Extra staff", "Text number", "Text messages"]);
  });

  it("never goes negative when usage is below the allowance", () => {
    expect(monthlyBill({ locations: 0, activeStaff: 0, hasNumber: false, smsLast30Days: 0 }, book).totalCents).toBe(2900);
  });
});

describe("effectivePriceBook", () => {
  it("applies only the overridden fields, including an explicit zero", () => {
    const p = effectivePriceBook(book, { baseCents: 0, perStaffCents: null, perLocationCents: 1000 });
    expect(p.baseCents).toBe(0);
    expect(p.perLocationCents).toBe(1000);
    expect(p.perStaffCents).toBe(500);
    expect(p.numberCents).toBe(1500);
  });
  it("returns the defaults for no overrides", () => {
    expect(effectivePriceBook(book, null)).toEqual(book);
  });
});
