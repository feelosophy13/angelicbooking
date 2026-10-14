import { describe, expect, it } from "vitest";
import { monthlyFromItems } from "../stripe-items";

describe("monthlyFromItems", () => {
  it("sums licensed items by quantity and skips metered usage", () => {
    expect(monthlyFromItems([
      { quantity: 1, price: { unit_amount: 2900, recurring: { interval: "month", usage_type: "licensed" } } },
      { quantity: 4, price: { unit_amount: 500, recurring: { interval: "month", usage_type: "licensed" } } },
      { price: { unit_amount: 2, recurring: { interval: "month", usage_type: "metered" } } },
    ])).toBe(4900);
  });
  it("normalises yearly prices to a month", () => {
    expect(monthlyFromItems([{ quantity: 1, price: { unit_amount: 24000, recurring: { interval: "year", usage_type: "licensed" } } }])).toBe(2000);
  });
});
