import { describe, expect, it } from "vitest";
import { parseCents, parseCount, readPrices } from "../price-form";

describe("price form parsing", () => {
  it("reads dollars into cents", () => {
    expect(parseCents("29")).toBe(2900);
    expect(parseCents("$1,029.50")).toBe(102950);
    expect(parseCents("0.02")).toBe(2);
    expect(parseCents("")).toBeNull();
    expect(parseCents("1.234")).toBeNull();
    expect(parseCents("-5")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });
  it("reads whole counts", () => {
    expect(parseCount("12")).toBe(12);
    expect(parseCount("1.5")).toBeNull();
    expect(parseCount("-1")).toBeNull();
  });
  it("requires every field on the price book but allows blanks on overrides", () => {
    const form = new FormData();
    form.set("baseCents", "29");
    expect(readPrices(form, false).errors.length).toBeGreaterThan(0);
    const o = readPrices(form, true);
    expect(o.errors).toEqual([]);
    expect(o.values.baseCents).toBe(2900);
    expect(o.values.perStaffCents).toBeNull();
  });
});
