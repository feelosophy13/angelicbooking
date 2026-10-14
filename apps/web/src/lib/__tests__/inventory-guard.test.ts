import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { lowStockEmail } from "../notify/templates";

const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("inventory rules", () => {
  it("stock changes only through server/inventory.ts, so the total and the locations never drift", () => {
    const offenders = files
      .filter((f) => f.rel !== "server/inventory.ts")
      .filter((f) => /insert\(schema\.stockMovements\)|insert\(schema\.productStock\)|update\(schema\.productStock\)|stockQty:\s*sql/.test(f.text))
      .map((f) => f.rel);
    expect(offenders, "move stock with the functions in server/inventory.ts").toEqual([]);
  });

  it("a refund does not put goods back on the shelf (the product may be gone: never arrived, goodwill)", () => {
    const sales = files.find((f) => f.rel === "server/sales.ts")!.text;
    expect(sales).not.toMatch(/stockMovements|stockQty|productStock/);
  });

  it("back-bar products are never offered for sale", () => {
    const sales = files.find((f) => f.rel === "server/sales.ts")!.text;
    const store = files.find((f) => f.rel === "server/store.ts")!.text;
    expect(sales).toMatch(/kind !== "retail"/);
    expect(store.match(/schema\.products\.kind, "retail"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the stock pages and actions need the inventory permission, not just any login", () => {
    const actions = files.find((f) => f.rel === "app/app/[slug]/inventory/actions.ts")!.text;
    const calls = actions.match(/requireAction\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(5);
    // Everything needs inventory.manage, except logging supplies used, which is for whoever did the work.
    const others = calls.filter((c) => !c.includes('"inventory.manage"'));
    expect(others).toEqual(['requireAction(d.data.slug, "inventory.log")']);
  });
});

describe("low-stock email", () => {
  it("lists each product with how it stands and links to the reorder list", () => {
    const t = lowStockEmail(
      { businessName: "Test Salon", logoUrl: null, brandColor: null, businessPhone: null, address: null },
      { items: [{ name: "Shampoo", onHand: 0, onOrder: 6, status: "out" }, { name: "Gel · 7N", onHand: -2, onOrder: 0, status: "negative" }, { name: "Serum", onHand: 2, onOrder: 0, status: "low" }], more: 4, link: "https://x.test/app/s/inventory/reorder" },
    );
    expect(t.subject).toBe("7 products to reorder · Test Salon");
    expect(t.html).toContain("out of stock · 6 on order");
    expect(t.html).toContain("count is off (-2)");
    expect(t.html).toContain("2 left");
    expect(t.html).toContain("and 4 more");
    expect(t.html).toContain("https://x.test/app/s/inventory/reorder");
  });
});
