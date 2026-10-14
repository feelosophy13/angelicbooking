import { describe, expect, it } from "vitest";
import { daysOfStock, locationAlerts, worstStatus, manualDelta, movementReason, productLabel, readProductRows, stockStatus, suggestedOrderQty } from "../inventory";

describe("stock status", () => {
  it("tells a count that is off from out, low and fine", () => {
    expect(stockStatus(-2, 3)).toBe("negative");
    expect(stockStatus(0, 3)).toBe("out");
    expect(stockStatus(3, 3)).toBe("low");
    expect(stockStatus(4, 3)).toBe("ok");
  });
});

describe("reorder suggestion", () => {
  it("orders nothing while stock is above the warning level", () => {
    expect(suggestedOrderQty({ onHand: 6, onOrder: 0, threshold: 3, reorderUpTo: 12 })).toBe(0);
  });
  it("brings the count up to the target", () => {
    expect(suggestedOrderQty({ onHand: 2, onOrder: 0, threshold: 3, reorderUpTo: 12 })).toBe(10);
  });
  it("defaults the target to twice the warning level", () => {
    expect(suggestedOrderQty({ onHand: 1, onOrder: 0, threshold: 3, reorderUpTo: null })).toBe(5);
  });
  it("counts what is already on order, so nothing is ordered twice", () => {
    expect(suggestedOrderQty({ onHand: 1, onOrder: 10, threshold: 3, reorderUpTo: 12 })).toBe(0);
    expect(suggestedOrderQty({ onHand: 1, onOrder: 2, threshold: 3, reorderUpTo: 12 })).toBe(9);
  });
  it("covers a count that went negative", () => {
    expect(suggestedOrderQty({ onHand: -2, onOrder: 0, threshold: 3, reorderUpTo: 12 })).toBe(14);
  });
  it("still orders something when the warning level is zero and it is out", () => {
    expect(suggestedOrderQty({ onHand: 0, onOrder: 0, threshold: 0, reorderUpTo: null })).toBe(1);
  });
});

describe("days of stock", () => {
  it("projects from the recent pace", () => {
    expect(daysOfStock(10, 30, 30)).toBe(10);
  });
  it("has no answer when nothing sold", () => {
    expect(daysOfStock(10, 0, 30)).toBeNull();
  });
  it("is zero when the shelf is empty or negative", () => {
    expect(daysOfStock(-3, 30, 30)).toBe(0);
  });
});

describe("manual movements", () => {
  it("received always adds, write-offs always remove, adjust keeps its sign", () => {
    expect(manualDelta("received", -5)).toBe(5);
    expect(manualDelta("damage", 2)).toBe(-2);
    expect(manualDelta("expired", -2)).toBe(-2);
    expect(manualDelta("adjust", -4)).toBe(-4);
    expect(manualDelta("adjust", 4)).toBe(4);
  });
  it("names every reason in words", () => {
    expect(movementReason("supplier_return")).toBe("Sent back to supplier");
    expect(movementReason("something_new")).toBe("something_new");
  });
});

describe("product label", () => {
  it("joins the option to the name", () => {
    expect(productLabel({ name: "Color Gel", variantLabel: "7N" })).toBe("Color Gel · 7N");
    expect(productLabel({ name: "Shampoo", variantLabel: null })).toBe("Shampoo");
  });
});

describe("reading a product spreadsheet", () => {
  it("accepts common header names in any order and leaves blanks as null", () => {
    const { rows, errors } = readProductRows([
      ["Product", "Qty", "Retail Price", "UPC", "Vendor"],
      ["Shampoo", "12", "$24.50", "0123456789012", "Acme"],
      ["Conditioner", "", "", "", ""],
    ]);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Shampoo", onHand: 12, priceCents: 2450, barcode: "0123456789012", supplier: "Acme" });
    expect(rows[1]).toMatchObject({ name: "Conditioner", onHand: null, priceCents: null, barcode: null });
  });
  it("reads yes/no columns", () => {
    const { rows } = readProductRows([["Name", "Track stock", "Sell online", "Taxable"], ["A", "Yes", "n", ""]]);
    expect(rows[0]).toMatchObject({ trackStock: true, sellOnline: false, taxable: null });
  });
  it("reports a missing name column and rows without a name", () => {
    expect(readProductRows([["SKU"], ["1"]]).errors[0]).toMatch(/Name/);
    expect(readProductRows([["Name"], [""]]).errors[0]).toMatch(/Row 2/);
  });
});

describe("per-location alerts", () => {
  const row = (locationId: string, qty: number, extra: Partial<{ onOrder: number; recentlyMoved: boolean }> = {}) => ({ locationId, qty, onOrder: 0, recentlyMoved: true, ...extra });
  it("judges each location on its own count", () => {
    const a = locationAlerts({ threshold: 3, multiLocation: true, rows: [row("main", 12), row("down", 0)] });
    expect(a).toEqual([{ locationId: "down", qty: 0, onOrder: 0, status: "out" }]);
  });
  it("puts the worst first and reports low as low", () => {
    const a = locationAlerts({ threshold: 3, multiLocation: true, rows: [row("a", 2), row("b", -1), row("c", 0)] });
    expect(a.map((x) => x.status)).toEqual(["negative", "out", "low"]);
  });
  it("stays quiet where the product isn't kept: none, nothing sold or used lately, nothing coming", () => {
    expect(locationAlerts({ threshold: 3, multiLocation: true, rows: [row("main", 9), row("down", 0, { recentlyMoved: false })] })).toEqual([]);
    expect(locationAlerts({ threshold: 3, multiLocation: true, rows: [row("down", 0, { recentlyMoved: false, onOrder: 4 })] })).toHaveLength(1);
  });
  it("still flags a count that is off, and a low count, wherever it is", () => {
    expect(locationAlerts({ threshold: 3, multiLocation: true, rows: [row("down", -2, { recentlyMoved: false }), row("up", 1, { recentlyMoved: false })] })).toHaveLength(2);
  });
  it("with one location zero is simply out", () => {
    expect(locationAlerts({ threshold: 3, multiLocation: false, rows: [row("main", 0, { recentlyMoved: false })] })).toHaveLength(1);
  });
  it("summarises as the worst status", () => {
    expect(worstStatus([])).toBe("ok");
    expect(worstStatus(["low", "out", "ok"])).toBe("out");
  });
});
