import { describe, expect, it } from "vitest";
import { groupSummary, MAX_OPTIONS, newLabels, optionCombos, parseOptionList, priceRange } from "../variants";

describe("reading a list of options", () => {
  it("takes one per line, or commas, and tidies them", () => {
    expect(parseOptionList("7N\n  8N ,  9N;\n\n10N")).toEqual(["7N", "8N", "9N", "10N"]);
  });
  it("drops repeats ignoring case, keeping the first spelling", () => {
    expect(parseOptionList("Red, red, RED, Blue")).toEqual(["Red", "Blue"]);
  });
  it("collapses spaces, caps a label's length and the number of options", () => {
    expect(parseOptionList("50   ml")).toEqual(["50 ml"]);
    expect(parseOptionList("x".repeat(100))[0]).toHaveLength(40);
    expect(parseOptionList(Array.from({ length: 300 }, (_, i) => `o${i}`).join(","))).toHaveLength(MAX_OPTIONS);
  });
  it("is empty for blank text", () => {
    expect(parseOptionList("  \n , ")).toEqual([]);
  });
});

describe("combining two kinds of option", () => {
  it("multiplies shades by sizes", () => {
    expect(optionCombos(["7N", "8N"], ["50 ml", "100 ml"])).toEqual(["7N / 50 ml", "7N / 100 ml", "8N / 50 ml", "8N / 100 ml"]);
  });
  it("is just the first list when there is no second", () => {
    expect(optionCombos(["a", "b"], [])).toEqual(["a", "b"]);
    expect(optionCombos([], ["x"])).toEqual(["x"]);
  });
});

describe("skipping options that already exist", () => {
  it("adds only new labels, ignoring case", () => {
    expect(newLabels(["7N", "8n"], ["7n", "8N", "9N"])).toEqual({ add: ["9N"], skipped: ["7n", "8N"] });
  });
});

describe("summing a group up", () => {
  const rows = [
    { priceCents: 3200, stockQty: 9, status: "ok" as const, tracked: true, active: true },
    { priceCents: 5400, stockQty: 3, status: "low" as const, tracked: true, active: true },
    { priceCents: 9900, stockQty: 50, status: "ok" as const, tracked: true, active: false },
  ];
  it("counts options, ranges the price and totals the stock of the options still sold", () => {
    const s = groupSummary(rows);
    expect(s).toMatchObject({ options: 3, active: 2, minPrice: 3200, maxPrice: 5400, totalStock: 12, worst: "low" });
  });
  it("has no stock figure when nothing is tracked", () => {
    expect(groupSummary([{ priceCents: 100, stockQty: 0, status: "ok", tracked: false, active: true }]).anyTracked).toBe(false);
  });
  it("shows one price or a range", () => {
    const f = (c: number) => `$${c / 100}`;
    expect(priceRange(3200, 3200, f)).toBe("$32");
    expect(priceRange(3200, 5400, f)).toBe("$32–$54");
  });
});
