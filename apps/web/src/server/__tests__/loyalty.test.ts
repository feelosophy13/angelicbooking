import { describe, expect, it } from "vitest";
import { pointsForSale } from "../loyalty";

const biz = { loyaltyEnabled: true, loyaltyPointsPerDollar: 10, loyaltyPointsPerVisit: 5 } as Parameters<typeof pointsForSale>[0];

describe("loyalty points", () => {
  it("earns on the discounted subtotal, not tips, plus the visit bonus", () => {
    expect(pointsForSale(biz, { subtotalCents: 7000, discountCents: 700, tipCents: 1000 })).toBe(630 + 5);
  });
  it("earns nothing when off", () => {
    expect(pointsForSale({ ...biz, loyaltyEnabled: false }, { subtotalCents: 7000, discountCents: 0, tipCents: 0 })).toBe(0);
  });
  it("never goes negative on a fully discounted sale", () => {
    expect(pointsForSale(biz, { subtotalCents: 1000, discountCents: 1500, tipCents: 0 })).toBe(5);
  });
});
