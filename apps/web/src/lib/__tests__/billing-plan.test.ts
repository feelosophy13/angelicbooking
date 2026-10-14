import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_BOOK } from "@angelic/core/platform-pricing";
import { desiredItems, kindOf, planChanges, priceKey } from "../billing-plan";

const book = { ...DEFAULT_PRICE_BOOK, baseCents: 2900, includedLocations: 1, perLocationCents: 1500, includedStaff: 2, perStaffCents: 500 };

describe("desiredItems", () => {
  it("is just the base plan inside the allowances", () => {
    expect(desiredItems(book, { locations: 1, activeStaff: 2 })).toEqual([{ kind: "base", lookupKey: "angelic_base_monthly_2900", cents: 2900, quantity: 1 }]);
  });
  it("adds extra locations and staff as quantities", () => {
    const items = desiredItems(book, { locations: 3, activeStaff: 7 });
    expect(items.map((i) => [i.kind, i.quantity])).toEqual([["base", 1], ["location", 2], ["staff", 5]]);
  });
  it("leaves out extras that are free", () => {
    expect(desiredItems({ ...book, perLocationCents: 0, perStaffCents: 0 }, { locations: 9, activeStaff: 9 })).toHaveLength(1);
  });
  it("keeps a $0 base plan as the subscription anchor", () => {
    expect(desiredItems({ ...book, baseCents: 0 }, { locations: 1, activeStaff: 1 })[0]).toMatchObject({ kind: "base", cents: 0 });
  });
});

describe("planChanges", () => {
  const base = { id: "si_base", lookupKey: priceKey("base", 2900), quantity: 1 };
  it("does nothing when the subscription already matches", () => {
    const plan = planChanges(desiredItems(book, { locations: 1, activeStaff: 2 }), [base]);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });
  it("creates, updates and removes to reach the target", () => {
    const existing = [base, { id: "si_staff", lookupKey: priceKey("staff", 500), quantity: 3 }, { id: "si_loc", lookupKey: priceKey("location", 1500), quantity: 1 }];
    const plan = planChanges(desiredItems(book, { locations: 1, activeStaff: 7 }), existing);
    expect(plan.update).toEqual([{ id: "si_staff", desired: expect.objectContaining({ quantity: 5 }), quantityChanged: true, priceChanged: false }]);
    expect(plan.remove).toEqual(["si_loc"]);
    expect(plan.create).toEqual([]);
    expect(planChanges(desiredItems(book, { locations: 2, activeStaff: 2 }), [base]).create.map((c) => c.kind)).toEqual(["location"]);
  });
  it("switches an item to the new price when the price book changes", () => {
    const plan = planChanges(desiredItems({ ...book, baseCents: 3900 }, { locations: 1, activeStaff: 1 }), [base]);
    expect(plan.update).toEqual([{ id: "si_base", desired: expect.objectContaining({ lookupKey: "angelic_base_monthly_3900" }), quantityChanged: false, priceChanged: true }]);
  });
  it("never touches the text number or usage items", () => {
    const plan = planChanges(desiredItems(book, { locations: 1, activeStaff: 1 }), [base, { id: "si_num", lookupKey: "angelic_sms_number_monthly_1500", quantity: 1 }, { id: "si_use", lookupKey: "angelic_sms_usage_2_incl_0", quantity: 0 }]);
    expect(plan.remove).toEqual([]);
  });
  it("classifies lookup keys", () => {
    expect(kindOf("angelic_staff_monthly_500")).toBe("staff");
    expect(kindOf("angelic_sms_number_monthly_1500")).toBeNull();
    expect(kindOf(null)).toBeNull();
  });
});
