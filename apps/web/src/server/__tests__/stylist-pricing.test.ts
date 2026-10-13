import { describe, expect, it } from "vitest";
import { parseMinutesField, parsePriceField, priceLabel, termsOf, TermError } from "../stylist-pricing";

const base = { priceCents: 16000, durationMin: 120 };

describe("termsOf", () => {
  it("falls back to the service's own price and length", () => {
    expect(termsOf(base, undefined)).toEqual({ priceCents: 16000, durationMin: 120, priceCustom: false, durationCustom: false });
    expect(termsOf(base, { price: null, duration: null }).priceCustom).toBe(false);
  });
  it("uses a stylist's own price and length", () => {
    expect(termsOf(base, { price: 18000, duration: 150 })).toEqual({ priceCents: 18000, durationMin: 150, priceCustom: true, durationCustom: true });
    expect(termsOf(base, { price: 18000, duration: null })).toMatchObject({ priceCustom: true, durationCustom: false, durationMin: 120 });
  });
  it("does not call an override equal to the base custom", () => {
    expect(termsOf(base, { price: 16000, duration: 120 })).toMatchObject({ priceCustom: false, durationCustom: false });
  });
});

describe("priceLabel", () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  it("is one price when providers agree and a lowest price when they differ", () => {
    expect(priceLabel({ min: 16000, max: 16000 }, fmt)).toEqual({ label: "$160.00", varies: false });
    expect(priceLabel({ min: 16000, max: 18000 }, fmt)).toEqual({ label: "$160.00", varies: true });
  });
});

describe("posted fields", () => {
  it("distinguishes absent, blank and a value", () => {
    expect(parsePriceField(null)).toBeUndefined();
    expect(parsePriceField("")).toBeNull();
    expect(parsePriceField("  ")).toBeNull();
    expect(parsePriceField("180")).toBe(18000);
    expect(parsePriceField("$45.50")).toBe(4550);
    expect(parseMinutesField(undefined)).toBeUndefined();
    expect(parseMinutesField("")).toBeNull();
    expect(parseMinutesField("150")).toBe(150);
  });
  it("rejects nonsense", () => {
    expect(() => parsePriceField("abc")).toThrow(TermError);
    expect(() => parsePriceField("-5")).toThrow(TermError);
    expect(() => parseMinutesField("2")).toThrow(TermError);
    expect(() => parseMinutesField("12.5")).toThrow(TermError);
    expect(() => parseMinutesField("700")).toThrow(TermError);
  });
});
