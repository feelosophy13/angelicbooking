import { describe, expect, it } from "vitest";
import { rollUpCategories, withPrevious } from "@/lib/category-rollup";

const cats = [
  { id: "hair", name: "Hair", sortOrder: 0, parentId: null },
  { id: "color", name: "Color", sortOrder: 0, parentId: "hair" },
  { id: "balayage", name: "Balayage", sortOrder: 0, parentId: "color" },
  { id: "cuts", name: "Cuts", sortOrder: 1, parentId: "hair" },
  { id: "nails", name: "Nails", sortOrder: 1, parentId: null },
];

describe("rollUpCategories", () => {
  it("rolls leaves into their top-level category, lists the second level, and keeps paid, credit and pay apart", () => {
    const rows = rollUpCategories(
      [
        { categoryId: "balayage", count: 2, amount: 30_000, credit: 0 },
        { categoryId: "cuts", count: 3, amount: 9_000, credit: 6_000 },
        { categoryId: "nails", count: 1, amount: 0, credit: 4_000 },
        { categoryId: null, count: 1, amount: 1_000, credit: 0 },
      ],
      cats,
      new Map([["balayage", 15_000], ["cuts", 7_500], ["nails", 2_000], [null, 500]]),
    );
    expect(rows.map((r) => [r.name, r.count, r.paid, r.credit, r.pay])).toEqual([
      ["Hair", 5, 39_000, 6_000, 22_500],
      ["Nails", 1, 0, 4_000, 2_000],
      ["Uncategorized", 1, 1_000, 0, 500],
    ]);
    // Balayage (third level) shows under Color (second level); sub-categories sort by paid + credit.
    expect(rows[0]!.children.map((c) => [c.name, c.paid, c.credit, c.pay])).toEqual([["Color", 30_000, 0, 15_000], ["Cuts", 9_000, 6_000, 7_500]]);
  });

  it("sorts by paid plus credit, so a category used mostly on packages is not buried", () => {
    const rows = rollUpCategories([{ categoryId: "hair", count: 1, amount: 5_000, credit: 0 }, { categoryId: "nails", count: 2, amount: 0, credit: 8_000 }], cats);
    expect(rows.map((r) => r.name)).toEqual(["Nails", "Hair"]);
    expect(rows.every((r) => r.pay === null)).toBe(true);
  });

  it("keeps a row for pay with no sales (a clawback this period on an earlier visit) and drops an empty uncategorised row", () => {
    const rows = rollUpCategories([{ categoryId: "hair", count: 1, amount: 5_000, credit: 0 }], cats, new Map([["hair", 2_500], ["nails", -1_000]]));
    expect(rows.map((r) => [r.name, r.count, r.paid, r.pay])).toEqual([["Hair", 1, 5_000, 2_500], ["Nails", 0, 0, -1_000]]);
  });

  it("withPrevious matches the earlier period by id at both levels", () => {
    const now = rollUpCategories([{ categoryId: "cuts", count: 1, amount: 5_000, credit: 1_000 }, { categoryId: "nails", count: 1, amount: 2_000, credit: 0 }], cats);
    const before = rollUpCategories([{ categoryId: "cuts", count: 1, amount: 3_000, credit: 500 }, { categoryId: "color", count: 1, amount: 9_000, credit: 0 }], cats);
    withPrevious(now, before);
    expect(now.find((r) => r.id === "hair")!.before).toBe(12_500);
    expect(now.find((r) => r.id === "hair")!.children.find((c) => c.id === "cuts")!.before).toBe(3_500);
    expect(now.find((r) => r.id === "nails")!.before).toBe(0);
  });
});
