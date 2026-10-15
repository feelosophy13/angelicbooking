import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_BOOK } from "@angelic/core/platform-pricing";
import { canBuyNumber, configFromBook, isDelinquent, isSubscribed, lookupKeys, NUMBER_KEY_PREFIX, smsPausedReason } from "../billing-config";

const book = { ...DEFAULT_PRICE_BOOK, baseCents: 2900, numberCents: 1500, smsUsageCents: 2, smsIncluded: 100, trialDays: 14 };

describe("billing config", () => {
  it("is derived from the price book, with no environment involved", () => {
    expect(configFromBook(book)).toEqual({ baseCents: 2900, numberCents: 1500, smsUsageCents: 2, smsIncluded: 100, trialDays: 14 });
    expect(configFromBook(DEFAULT_PRICE_BOOK)).toEqual({ baseCents: 0, numberCents: 0, smsUsageCents: 0, smsIncluded: 0, trialDays: 0 });
  });

  it("encodes amounts in the Stripe lookup keys so a price change makes a new price", () => {
    const a = lookupKeys({ baseCents: 0, numberCents: 1500, smsUsageCents: 2, smsIncluded: 0, trialDays: 0 });
    const b = lookupKeys({ baseCents: 2900, numberCents: 1500, smsUsageCents: 3, smsIncluded: 100, trialDays: 0 });
    expect(a.base).not.toBe(b.base);
    expect(a.number).toBe(b.number);
    expect(a.usage).not.toBe(b.usage);
    expect(a.number.startsWith(NUMBER_KEY_PREFIX)).toBe(true);
  });

  it("statuses", () => {
    expect(isSubscribed("active")).toBe(true);
    expect(isSubscribed("trialing")).toBe(true);
    expect(isSubscribed("past_due")).toBe(true);
    expect(isSubscribed("canceled")).toBe(false);
    expect(isSubscribed("none")).toBe(false);
    expect(isDelinquent("past_due")).toBe(true);
    expect(isDelinquent("active")).toBe(false);
  });

  it("only requires a card for a number when it costs something", () => {
    const paid = { baseCents: 0, numberCents: 1500, smsUsageCents: 2, smsIncluded: 0, trialDays: 0 };
    const free = { ...paid, numberCents: 0, smsUsageCents: 0 };
    expect(canBuyNumber({ billingEnabled: true, status: "none", config: paid })).toBe(false);
    expect(canBuyNumber({ billingEnabled: true, status: "past_due", config: paid })).toBe(false);
    expect(canBuyNumber({ billingEnabled: true, status: "active", config: paid })).toBe(true);
    expect(canBuyNumber({ billingEnabled: true, status: "none", config: free })).toBe(true);
    expect(canBuyNumber({ billingEnabled: false, status: "none", config: paid })).toBe(true);
  });
});

describe("texts paused without a subscription", () => {
  const base = { billingEnabled: true, comped: false, status: "none", smsUsageCents: 2 };
  it("pauses texts for a business that has no active or trialing subscription", () => {
    for (const status of ["none", "canceled", "past_due", "unpaid", "incomplete", "paused"]) expect(smsPausedReason({ ...base, status })).toMatch(/paused/i);
  });
  it("lets them through with an active or trialing subscription", () => {
    expect(smsPausedReason({ ...base, status: "active" })).toBeNull();
    expect(smsPausedReason({ ...base, status: "trialing" })).toBeNull();
  });
  it("never pauses a comped business, a free text price, or a platform with billing off", () => {
    expect(smsPausedReason({ ...base, comped: true })).toBeNull();
    expect(smsPausedReason({ ...base, smsUsageCents: 0 })).toBeNull();
    expect(smsPausedReason({ ...base, billingEnabled: false })).toBeNull();
  });
});
