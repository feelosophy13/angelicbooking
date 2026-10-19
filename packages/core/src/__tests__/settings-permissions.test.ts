import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, can, type Action } from "../permissions";

/** "Business settings" no longer implies the Stripe connection, the subscription, API keys, the text number or the activity log: each is its own permission. */
describe("settings permissions", () => {
  const split = ["billing.manage", "integrations.manage", "audit.view"] as const satisfies readonly Action[];

  it("exist and are listed under Settings in the role editor", () => {
    const setup = PERMISSION_GROUPS.find((g) => g.title === "Settings")!;
    const listed = setup.items.map((i) => i.action);
    for (const a of split) {
      expect(ACTIONS).toContain(a);
      expect(listed).toContain(a);
    }
  });

  it("Business settings no longer promises payments, billing or keys", () => {
    const item = PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.action === "business.manage")!;
    expect(item.label).toBe("Business settings");
    expect(item.description.toLowerCase()).not.toContain("stripe");
    expect(item.description.toLowerCase()).toContain("not payments, billing or api keys");
  });

  it("Owner has all three", () => {
    for (const a of split) expect(can("owner", a), a).toBe(true);
  });

  it("Manager edits the everyday settings and reads the activity log, but holds no money or keys", () => {
    const m = DEFAULT_ROLE_PERMISSIONS.manager;
    expect(m.has("business.manage")).toBe(true);
    expect(m.has("audit.view")).toBe(true);
    expect(m.has("billing.manage")).toBe(false);
    expect(m.has("integrations.manage")).toBe(false);
    expect(DEFAULT_ROLE_META.manager.description).toBe("Everything except Stripe, billing and API keys.");
  });

  it("Front desk and Provider touch no settings", () => {
    for (const role of ["front_desk", "provider"] as const) {
      const p = DEFAULT_ROLE_PERMISSIONS[role];
      expect(p.has("business.manage"), role).toBe(false);
      for (const a of split) expect(p.has(a), `${role} ${a}`).toBe(false);
    }
  });
});
