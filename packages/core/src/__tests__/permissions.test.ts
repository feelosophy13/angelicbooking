import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, can, canActOnAppointment, type Action } from "../permissions";

describe("permissions", () => {
  it("owner can do everything, manager everything but Stripe, billing and API keys", () => {
    expect(can("owner", "billing.manage")).toBe(true);
    expect(can("manager", "business.manage")).toBe(true);
    expect(can("manager", "billing.manage")).toBe(false);
    expect(can("manager", "integrations.manage")).toBe(false);
    expect(can("manager", "payroll.view")).toBe(true);
    for (const a of ACTIONS) expect(can("owner", a), a).toBe(true);
  });
  it("providers only touch their own calendar", () => {
    expect(canActOnAppointment("provider", "write", "u1", "u1")).toBe(true);
    expect(canActOnAppointment("provider", "write", "u1", "u2")).toBe(false);
    expect(canActOnAppointment("front_desk", "write", "u1", "u2")).toBe(true);
    expect(can("provider", "reports.view")).toBe(false);
  });
  it("sending marketing is its own permission: managers have it, reports readers at the desk do not", () => {
    expect(can("owner", "marketing.send")).toBe(true);
    expect(can("manager", "marketing.send")).toBe(true);
    expect(can("front_desk", "marketing.send")).toBe(false);
    expect(can("provider", "marketing.send")).toBe(false);
  });
  it("rejects unknown roles", () => {
    expect(can("admin", "clients.read")).toBe(false);
    expect(can(null, "clients.read")).toBe(false);
  });
});

/** PERMISSIONS-PLAN-2026-10-18.md section 3: the defaults table, row by row. O = Owner, M = Manager, F = Front desk, P = Provider. */
describe("default role table (phase 1)", () => {
  const table: Record<string, string> = {
    "waitlist.view": "OMF", "waitlist.manage": "OMF",
    "clients.read": "OMFP", "clients.contact": "OMF", "clients.spend": "OMF",
    "reviews.view": "OMF", "reviews.view.own": "P",
    "checkout.take": "OMFP", "sales.view.own": "P", "sales.view.all": "OMF", "checkout.discount": "OMF", "checkout.refund": "OM",
    "giftcards.view": "OMF", "giftcards.issue": "OM", "reports.view": "OM", "payroll.view": "OM",
    "staff.directory": "OMFP", "staff.schedules.view": "OMF", "staff.manage": "OM", "time.view.all": "OMF", "time.edit": "OM", "members.manage": "OM",
    "catalog.view": "OMFP", "catalog.prices": "OMFP", "catalog.costs": "OM", "services.manage": "OM", "inventory.view": "OMF", "inventory.log": "OMFP", "inventory.manage": "OM",
    "marketing.send": "OM", "forms.manage": "OM",
    "business.manage": "OM", "billing.manage": "O", "integrations.manage": "O", "audit.view": "OM",
  };
  // The Owner always has everything (checked above), so the table is checked for the three editable roles.
  const letter = { manager: "M", front_desk: "F", provider: "P" } as const;
  for (const [action, roles] of Object.entries(table)) {
    it(`${action} → ${roles}`, () => {
      for (const [role, l] of Object.entries(letter)) expect(DEFAULT_ROLE_PERMISSIONS[role as keyof typeof letter].has(action as Action), `${role} ${action}`).toBe(roles.includes(l));
    });
  }
  it("every action is listed exactly once on the Roles page, and every listed action exists", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.action));
    expect([...listed].sort()).toEqual([...ACTIONS].sort());
    for (const g of PERMISSION_GROUPS) {
      expect(g.description.length).toBeGreaterThan(10);
      for (const i of g.items) expect(i.description.length, i.action).toBeGreaterThan(10);
    }
  });
  it("the Roles page groups read in the plan's order", () => {
    expect(PERMISSION_GROUPS.map((g) => g.title)).toEqual(["Calendar", "Clients", "Reviews", "Checkout and money", "Staff", "Catalog and inventory", "Marketing and forms", "Settings"]);
  });
});
