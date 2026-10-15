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

describe("platform fee percent", () => {
  it("reads percents as basis points", async () => {
    const { parsePercentBps } = await import("../price-form");
    expect(parsePercentBps("0.5")).toBe(50);
    expect(parsePercentBps("1%")).toBe(100);
    expect(parsePercentBps("2.25")).toBe(225);
    expect(parsePercentBps("0")).toBe(0);
  });
  it("rejects junk and anything above 20%", async () => {
    const { parsePercentBps } = await import("../price-form");
    expect(parsePercentBps("")).toBeNull();
    expect(parsePercentBps("abc")).toBeNull();
    expect(parsePercentBps("21")).toBeNull();
    expect(parsePercentBps("-1")).toBeNull();
  });
});
