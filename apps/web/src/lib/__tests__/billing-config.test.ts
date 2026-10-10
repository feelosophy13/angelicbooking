import { afterEach, describe, expect, it } from "vitest";
import { billingConfig, canBuyNumber, isDelinquent, isSubscribed, lookupKeys } from "../billing-config";

const ENV = ["BILLING_BASE_CENTS", "SMS_NUMBER_MONTHLY_FEE_CENTS", "SMS_USAGE_CENTS", "SMS_INCLUDED_PER_MONTH", "BILLING_TRIAL_DAYS"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("billing config", () => {
  it("reads amounts from env with safe fallbacks", () => {
    process.env.BILLING_BASE_CENTS = "0";
    process.env.SMS_NUMBER_MONTHLY_FEE_CENTS = "1500";
    process.env.SMS_USAGE_CENTS = "2";
    process.env.SMS_INCLUDED_PER_MONTH = "garbage";
    delete process.env.BILLING_TRIAL_DAYS;
    const c = billingConfig();
    expect(c).toEqual({ baseCents: 0, numberCents: 1500, smsUsageCents: 2, smsIncluded: 0, trialDays: 0 });
  });

  it("encodes amounts in the Stripe lookup keys so a price change makes a new price", () => {
    const a = lookupKeys({ baseCents: 0, numberCents: 1500, smsUsageCents: 2, smsIncluded: 0, trialDays: 0 });
    const b = lookupKeys({ baseCents: 2900, numberCents: 1500, smsUsageCents: 3, smsIncluded: 100, trialDays: 0 });
    expect(a.base).not.toBe(b.base);
    expect(a.number).toBe(b.number);
    expect(a.usage).not.toBe(b.usage);
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
