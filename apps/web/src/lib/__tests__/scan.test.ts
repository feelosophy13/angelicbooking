import { describe, expect, it } from "vitest";
import { addScan, cleanCode, countDifference, matchProduct, matchScan, orderProgress, setQty, totalUnits } from "../scan";

const products = [
  { id: "a", label: "Lash Adhesive", barcode: "8801234010518", sku: "BB-114" },
  { id: "b", label: "Daily SPF", barcode: "012345678905", sku: "LX-106" },
  { id: "c", label: "No barcode", barcode: null, sku: "XYZ-1" },
];

describe("finding the product a scan belongs to", () => {
  it("matches a barcode, ignoring the line ending and spaces a scanner adds", () => {
    expect(matchProduct(products, "8801234010518\r\n")?.id).toBe("a");
    expect(matchProduct(products, " 8801234010518 ")?.id).toBe("a");
  });
  it("matches the SKU when there is no barcode, ignoring case", () => {
    expect(matchProduct(products, "xyz-1")?.id).toBe("c");
  });
  it("reads UPC-A and EAN-13 as the same code", () => {
    expect(matchProduct(products, "0012345678905")?.id).toBe("b");
    expect(matchProduct(products, "12345678905")?.id).toBe("b");
  });
  it("finds nothing for an unknown or empty code", () => {
    expect(matchProduct(products, "999")).toBeNull();
    expect(matchProduct(products, "  ")).toBeNull();
  });
  it("does not confuse two different numbers because of leading zeros alone", () => {
    expect(matchProduct([{ id: "x", label: "X", barcode: "1234", sku: null }], "01234")?.id).toBe("x");
    expect(matchProduct([{ id: "x", label: "X", barcode: "1234", sku: null }], "12340")).toBeNull();
  });
  it("cleans control characters", () => {
    expect(cleanCode("AB\u0003 12\n")).toBe("ab12");
  });
});

describe("more than one barcode per product", () => {
  const withCases = [{ id: "a", label: "Adhesive", barcode: "111", sku: "A-1", codes: [{ code: "999000", units: 12 }, { code: "0042", units: 1 }] }, { id: "b", label: "Gel", barcode: null, sku: null }];
  it("a case barcode stands for its whole pack", () => {
    expect(matchScan(withCases, "999000")).toMatchObject({ product: { id: "a" }, units: 12 });
    expect(matchScan(withCases, "111")).toMatchObject({ product: { id: "a" }, units: 1 });
  });
  it("compares the extra codes the same forgiving way", () => {
    expect(matchScan(withCases, "42\r\n")?.product.id).toBe("a");
    expect(matchProduct(withCases, "  999000 ")?.id).toBe("a");
  });
  it("a product with no extra codes still matches normally", () => {
    expect(matchScan([{ id: "x", label: "X", barcode: "5", sku: null }], "5")?.units).toBe(1);
  });
});

describe("tallying scans", () => {
  it("adds one per scan and puts the latest product first", () => {
    let l = addScan([], "a");
    l = addScan(l, "b");
    l = addScan(l, "a");
    expect(l).toEqual([{ productId: "b", qty: 1 }, { productId: "a", qty: 2 }].sort((x, y) => (x.productId === "b" ? -1 : 1)));
    expect(totalUnits(l)).toBe(3);
  });
  it("a typed quantity replaces it, and zero removes the line", () => {
    let l = addScan(addScan([], "a"), "a");
    l = setQty(l, "a", 12);
    expect(l[0]!.qty).toBe(12);
    expect(setQty(l, "a", 0)).toEqual([]);
    expect(setQty(l, "a", -3)).toEqual([]);
    expect(setQty(l, "a", 2.9)[0]!.qty).toBe(2);
  });
});

describe("checking a delivery against an order", () => {
  const order = [
    { lineId: "L1", productId: "a", ordered: 6, received: 2 },
    { lineId: "L2", productId: "b", ordered: 4, received: 0 },
    { lineId: "L3", productId: "c", ordered: 3, received: 0 },
  ];
  it("counts what came before plus what was just scanned", () => {
    const { lines } = orderProgress(order, [{ productId: "a", qty: 4 }, { productId: "b", qty: 2 }]);
    expect(lines.map((l) => [l.status, l.remaining])).toEqual([["complete", 0], ["short", 2], ["waiting", 3]]);
  });
  it("flags too many, and products that aren't on the order", () => {
    const r = orderProgress(order, [{ productId: "a", qty: 9 }, { productId: "zzz", qty: 1 }]);
    expect(r.lines[0]!.status).toBe("over");
    expect(r.notOnOrder).toEqual([{ productId: "zzz", qty: 1 }]);
  });
});

describe("counting", () => {
  it("is the counted number against the book", () => {
    expect(countDifference(7, 9)).toBe(-2);
    expect(countDifference(9, 9)).toBe(0);
  });
});
