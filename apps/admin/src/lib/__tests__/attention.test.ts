import { describe, expect, it } from "vitest";
import { needsAttention } from "../attention";
import type { TenantWithBill } from "../tenants";

const now = Date.parse("2026-10-14T12:00:00Z");
const DAY = 86_400_000;
const t = (o: Partial<TenantWithBill>) =>
  ({ id: "x", name: "X", slug: "x", subscriptionStatus: "none", trialEndsAt: null, comped: false, suspendedAt: null, suspendedReason: null, onboarded: true, appointments: 0, appointments30d: 0, createdAt: new Date(now - 100 * DAY), ...o }) as TenantWithBill;

describe("needsAttention", () => {
  it("orders failing payments before trials before the quiet ones", () => {
    const list = needsAttention([
      t({ id: "quiet", appointments: 9, appointments30d: 0 }),
      t({ id: "ending", trialEndsAt: new Date(now + 3 * DAY) }),
      t({ id: "failing", subscriptionStatus: "past_due" }),
      t({ id: "ended", trialEndsAt: new Date(now - 2 * DAY) }),
    ], now);
    expect(list.map((a) => a.tenant.id)).toEqual(["failing", "ended", "ending", "quiet"]);
  });
  it("flags a business that never finished setup, but not a brand-new one", () => {
    expect(needsAttention([t({ id: "old", onboarded: false, createdAt: new Date(now - 10 * DAY) })], now)[0]?.severity).toBe(4);
    expect(needsAttention([t({ id: "new", onboarded: false, createdAt: new Date(now - 1 * DAY) })], now)).toEqual([]);
  });
  it("lists a business once, and ignores comped businesses' trials", () => {
    expect(needsAttention([t({ subscriptionStatus: "unpaid", onboarded: false })], now)).toHaveLength(1);
    expect(needsAttention([t({ comped: true, trialEndsAt: new Date(now - DAY) })], now)).toEqual([]);
  });
  it("shows suspended businesses with the reason", () => {
    expect(needsAttention([t({ suspendedAt: new Date(now), suspendedReason: "chargeback" })], now)[0]?.reason).toBe("Suspended: chargeback");
  });
  it("stays quiet for a healthy business", () => {
    expect(needsAttention([t({ subscriptionStatus: "active", appointments: 5, appointments30d: 3 })], now)).toEqual([]);
  });
});
