import { describe, expect, it } from "vitest";
import { applyQuery, csvCell, matchesStatus, parseQuery, toCsv } from "../filters";
import type { TenantWithBill } from "../tenants";

const now = Date.parse("2026-10-14T12:00:00Z");
const base = {
  id: "1", name: "Luxe", slug: "luxe", plan: "trial", subscriptionStatus: "none", trialEndsAt: null, currentPeriodEnd: null, stripeChargesEnabled: false, stripeCustomerId: null,
  createdAt: new Date("2026-10-01"), ownerEmail: "o@x.com", clients: 5, staff: 2, locations: 1, appointments: 4, lastAppointmentAt: null, activeStaff: 2, appointments30d: 0, sms30d: 0,
  hasNumber: false, suspendedAt: null, suspendedReason: null, comped: false, stripeSubscriptionId: null, lastLoginAt: null, services: 3, onboarded: true,
  bill: { lines: [], totalCents: 0 }, price: {}, hasOverrides: false,
} as unknown as TenantWithBill;
const mk = (o: Partial<TenantWithBill>) => ({ ...base, ...o }) as TenantWithBill;

describe("status filters", () => {
  it("classifies tenants", () => {
    expect(matchesStatus(mk({ subscriptionStatus: "active" }), "paying", now)).toBe(true);
    expect(matchesStatus(mk({}), "trial", now)).toBe(true);
    expect(matchesStatus(mk({ subscriptionStatus: "past_due" }), "attention", now)).toBe(true);
    expect(matchesStatus(mk({ trialEndsAt: new Date(now + 3 * 86_400_000) }), "trial_ending", now)).toBe(true);
    expect(matchesStatus(mk({ trialEndsAt: new Date(now + 20 * 86_400_000) }), "trial_ending", now)).toBe(false);
    expect(matchesStatus(mk({ trialEndsAt: new Date(now - 86_400_000) }), "trial_ending", now)).toBe(false);
    expect(matchesStatus(mk({ appointments30d: 2 }), "inactive", now)).toBe(false);
    expect(matchesStatus(mk({ onboarded: false }), "not_onboarded", now)).toBe(true);
    expect(matchesStatus(mk({ suspendedAt: new Date() }), "suspended", now)).toBe(true);
  });
});

describe("applyQuery", () => {
  const rows = [mk({ id: "a", name: "Zed", slug: "zed", locations: 1 }), mk({ id: "b", name: "Amy", slug: "amy", ownerEmail: "boss@amy.com", locations: 3 })];
  it("searches name, slug and owner email", () => {
    expect(applyQuery(rows, parseQuery({ q: "boss@" }), now).map((t) => t.id)).toEqual(["b"]);
    expect(applyQuery(rows, parseQuery({ q: "ZED" }), now).map((t) => t.id)).toEqual(["a"]);
  });
  it("sorts, defaulting names ascending and numbers descending", () => {
    expect(applyQuery(rows, parseQuery({ sort: "name" }), now).map((t) => t.id)).toEqual(["b", "a"]);
    expect(applyQuery(rows, parseQuery({ sort: "locations" }), now).map((t) => t.id)).toEqual(["b", "a"]);
    expect(applyQuery(rows, parseQuery({ sort: "locations", dir: "asc" }), now).map((t) => t.id)).toEqual(["a", "b"]);
  });
  it("ignores unknown filter and sort values", () => {
    const q = parseQuery({ status: "bogus", sort: "bogus" });
    expect(q.status).toBe("all");
    expect(q.sort).toBe("created");
  });
});

describe("csv", () => {
  it("quotes and neutralises spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(toCsv([["a", 1], ["b", 2]])).toBe("a,1\r\nb,2\r\n");
  });
});
