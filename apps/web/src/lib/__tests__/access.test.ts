import { describe, expect, it } from "vitest";
import { accessState, checkoutTrial, emailDailyCap, isReservedSlug, safeSlugBase } from "../access";

const now = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const base = { billingEnabled: true, comped: false, status: "none", trialEndsAt: new Date(now + 5 * DAY), baseCents: 1000, now };

describe("accessState", () => {
  it("is a trial with days left until the trial ends, then expired", () => {
    expect(accessState(base)).toMatchObject({ state: "trial", daysLeft: 5 });
    expect(accessState({ ...base, trialEndsAt: new Date(now + 3_600_000) })).toMatchObject({ state: "trial", daysLeft: 1 });
    expect(accessState({ ...base, trialEndsAt: new Date(now - 1) }).state).toBe("expired");
  });
  it("is never locked with an active or trialing subscription, or past_due while Stripe retries", () => {
    for (const status of ["active", "trialing", "past_due"]) expect(accessState({ ...base, status, trialEndsAt: new Date(now - DAY) }).state).toBe("ok");
  });
  it("locks a cancelled or unpaid subscription even without a trial date", () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired"]) expect(accessState({ ...base, status, trialEndsAt: null }).state).toBe("expired");
  });
  it("grandfathers businesses with no trial date, and exempts comped, billing-off and free platforms", () => {
    expect(accessState({ ...base, trialEndsAt: null }).state).toBe("ok");
    expect(accessState({ ...base, comped: true, trialEndsAt: new Date(now - DAY) }).state).toBe("ok");
    expect(accessState({ ...base, billingEnabled: false, trialEndsAt: new Date(now - DAY) }).state).toBe("ok");
    expect(accessState({ ...base, baseCents: 0, trialEndsAt: new Date(now - DAY) }).state).toBe("ok");
  });
});

describe("emailDailyCap", () => {
  it("limits only businesses without a subscription, and 0 means no limit", () => {
    expect(emailDailyCap({ comped: false, status: "none", cap: 100 })).toBe(100);
    expect(emailDailyCap({ comped: false, status: "active", cap: 100 })).toBeNull();
    expect(emailDailyCap({ comped: true, status: "none", cap: 100 })).toBeNull();
    expect(emailDailyCap({ comped: false, status: "none", cap: 0 })).toBeNull();
  });
});

describe("business addresses", () => {
  it("reserves platform paths, demo prefixes and look-alikes", () => {
    for (const s of ["admin", "api", "app", "book", "demo", "demo-salon", "_host", "angelicbooking"]) expect(isReservedSlug(s)).toBe(true);
    expect(isReservedSlug("luxe-beauty")).toBe(false);
  });
  it("turns an unusable base into a usable one", () => {
    expect(safeSlugBase("admin")).toBe("admin-business");
    expect(safeSlugBase("demo-luxe")).toBe("luxe");
    expect(safeSlugBase("")).toBe("business");
    expect(safeSlugBase("luxe-beauty")).toBe("luxe-beauty");
  });
});

describe("checkoutTrial", () => {
  it("carries the remaining trial onto the subscription so an early card is not charged yet", () => {
    const end = new Date(now + 5 * DAY);
    expect(checkoutTrial(end, 14, now)).toEqual({ trial_end: Math.floor(end.getTime() / 1000) });
  });
  it("charges at once when under 48 hours remain or the trial is over", () => {
    expect(checkoutTrial(new Date(now + DAY), 14, now)).toEqual({});
    expect(checkoutTrial(new Date(now - DAY), 14, now)).toEqual({});
  });
  it("gives older businesses with no trial date the price book's trial length", () => {
    expect(checkoutTrial(null, 14, now)).toEqual({ trial_period_days: 14 });
    expect(checkoutTrial(null, 0, now)).toEqual({});
  });
});
