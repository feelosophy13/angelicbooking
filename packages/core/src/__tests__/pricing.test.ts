import { describe, expect, it } from "vitest";
import { allocateProportionally, computeTotals, parseMoney } from "../pricing";

describe("computeTotals", () => {
  const lines = [
    { kind: "service" as const, amountCents: 6500, taxable: false },
    { kind: "product" as const, amountCents: 2000, taxable: true },
    { kind: "tip" as const, amountCents: 1000, taxable: false },
  ];
  it("taxes only taxable goods and excludes tips from subtotal", () => {
    const t = computeTotals(lines, null, 825);
    expect(t).toEqual({ subtotalCents: 8500, discountCents: 0, taxCents: 165, tipCents: 1000, totalCents: 9665 });
  });
  it("applies a percent discount proportionally before tax", () => {
    const t = computeTotals(lines, { type: "percent", value: 10 }, 1000);
    expect(t.discountCents).toBe(850);
    expect(t.taxCents).toBe(180); // 2000 * 0.9 * 10%
    expect(t.totalCents).toBe(8500 - 850 + 180 + 1000);
  });
  it("caps an amount discount at the subtotal and never goes negative", () => {
    const t = computeTotals(lines, { type: "amount", value: 99999 }, 0);
    expect(t.discountCents).toBe(8500);
    expect(t.totalCents).toBe(1000);
  });
});

describe("allocateProportionally", () => {
  it("splits by weight and sums exactly", () => {
    const r = allocateProportionally(1000, [
      { key: "a", weight: 6500 },
      { key: "b", weight: 3500 },
    ]);
    expect(r).toEqual({ a: 650, b: 350 });
  });
  it("handles rounding with largest remainder", () => {
    const r = allocateProportionally(100, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    expect(Object.values(r).reduce((s, n) => s + n, 0)).toBe(100);
    expect(Object.values(r).sort()).toEqual([33, 33, 34]);
  });
  it("splits equally when weights are all zero", () => {
    expect(allocateProportionally(5, [{ key: "a", weight: 0 }, { key: "b", weight: 0 }])).toEqual({ a: 3, b: 2 });
  });
});

describe("parseMoney", () => {
  it("parses common inputs", () => {
    expect(parseMoney("45")).toBe(4500);
    expect(parseMoney("45.5")).toBe(4550);
    expect(parseMoney("$1,200.00")).toBe(120000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
  });
});
