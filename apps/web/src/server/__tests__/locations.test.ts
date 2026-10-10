import { describe, expect, it } from "vitest";
import { addressOf, effectiveLocationId, paymentContext, worksAt, type StaffLocationIndex } from "../locations";

const business = {
  id: "b1",
  name: "Angelic Beauty",
  stripeAccountId: "acct_main",
  stripeChargesEnabled: true,
  stripeDetailsSubmitted: true,
  taxRateBps: 600,
  addressLine: "14 Pidgeon Hill Dr, Sterling",
  phone: "571-626-5060",
} as unknown as Parameters<typeof paymentContext>[0];

const loc = (over: Partial<Parameters<typeof paymentContext>[1] & object>) =>
  ({ id: "l1", name: "Angelic Lashes by Tiffany", stripeAccountId: null, stripeChargesEnabled: false, stripeDetailsSubmitted: false, taxRateBps: null, addressLine1: "3925 Chain Bridge Rd", addressLine2: "#302", city: "Fairfax", state: "VA", postalCode: "22030", phone: "571-579-5656", ...over }) as NonNullable<Parameters<typeof paymentContext>[1]>;

describe("paymentContext", () => {
  it("falls back to the business's main account, tax rate and identity", () => {
    const p = paymentContext(business, loc({}));
    expect(p.accountId).toBe("acct_main");
    expect(p.usesMainAccount).toBe(true);
    expect(p.taxRateBps).toBe(600);
    expect(p.name).toBe("Angelic Beauty");
    expect(p.phone).toBe("571-626-5060");
  });
  it("uses the location's own account, tax rate and identity when it has one", () => {
    const p = paymentContext(business, loc({ stripeAccountId: "acct_fairfax", stripeChargesEnabled: false, taxRateBps: 0 }));
    expect(p.accountId).toBe("acct_fairfax");
    expect(p.usesMainAccount).toBe(false);
    expect(p.chargesEnabled).toBe(false);
    expect(p.taxRateBps).toBe(0);
    expect(p.name).toBe("Angelic Lashes by Tiffany");
    expect(p.addressLine).toBe("3925 Chain Bridge Rd #302, Fairfax, VA 22030");
    expect(p.phone).toBe("571-579-5656");
  });
  it("handles a business with no location row", () => {
    const p = paymentContext(business, null);
    expect(p.accountId).toBe("acct_main");
    expect(p.name).toBe("Angelic Beauty");
  });
});

describe("effectiveLocationId / worksAt", () => {
  it("prefers the row's location, then the staff member's primary, then the default", () => {
    expect(effectiveLocationId({ locationId: "a" }, "b", "c")).toBe("a");
    expect(effectiveLocationId({ locationId: null }, "b", "c")).toBe("b");
    expect(effectiveLocationId({ locationId: null }, null, "c")).toBe("c");
  });
  it("answers per weekday, and by 'any day' for staff without hours", () => {
    const idx: StaffLocationIndex = {
      byDay: new Map([["s1", new Map([[1, "sterling"], [2, "fairfax"]])]]),
      any: new Map([["s1", new Set(["sterling", "fairfax"])], ["s2", new Set(["sterling"])]]),
      noHours: new Set(["s2"]),
      defaultId: "sterling",
    };
    expect(worksAt(idx, "s1", 1, "sterling")).toBe(true);
    expect(worksAt(idx, "s1", 1, "fairfax")).toBe(false);
    expect(worksAt(idx, "s1", 2, "fairfax")).toBe(true);
    expect(worksAt(idx, "s1", 3, "fairfax")).toBe(false);
    expect(worksAt(idx, "s2", 4, "sterling")).toBe(true);
    expect(worksAt(idx, "s2", 4, "fairfax")).toBe(false);
    expect(worksAt(idx, "s1", 3, null)).toBe(true);
  });
});

describe("addressOf", () => {
  it("joins the parts that exist", () => {
    expect(addressOf({ addressLine1: "1 Main St", addressLine2: null, city: "Sterling", state: "VA", postalCode: null })).toBe("1 Main St, Sterling, VA");
    expect(addressOf(null)).toBeNull();
  });
});
