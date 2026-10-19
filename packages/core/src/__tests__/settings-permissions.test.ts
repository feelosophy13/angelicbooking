import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, can, type Action } from "../permissions";

/**
 * "Business settings" (business.manage) was split in two steps: 2026-10-18 the Stripe connection, the subscription, API keys, the text
 * number and the activity log became their own permissions (migration 0115); 2026-10-19 the rest became settings.business (profile and
 * setup) and settings.booking (booking, store and client-care rules), plus forms.manage, and business.manage was retired (migrations 0119, 0120).
 */
describe("settings permissions", () => {
  const all = ["settings.business", "settings.booking", "billing.manage", "integrations.manage", "audit.view"] as const satisfies readonly Action[];

  it("exist and are listed under Settings in the role editor", () => {
    const setup = PERMISSION_GROUPS.find((g) => g.title === "Settings")!;
    const listed = setup.items.map((i) => i.action);
    for (const a of all) {
      expect(ACTIONS).toContain(a);
      expect(listed).toContain(a);
    }
    expect(listed).not.toContain("business.manage");
  });

  it("neither settings permission promises payments, billing or keys", () => {
    for (const a of ["settings.business", "settings.booking"] as const) {
      const item = PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.action === a)!;
      expect(item.description.toLowerCase()).not.toContain("stripe");
      expect(item.description.toLowerCase()).not.toContain("api key");
    }
  });

  it("Owner has all of them", () => {
    for (const a of all) expect(can("owner", a), a).toBe(true);
  });

  it("Manager edits the business and its booking rules and reads the activity log, but holds no money or keys", () => {
    const m = DEFAULT_ROLE_PERMISSIONS.manager;
    expect(m.has("settings.business")).toBe(true);
    expect(m.has("settings.booking")).toBe(true);
    expect(m.has("audit.view")).toBe(true);
    expect(m.has("billing.manage")).toBe(false);
    expect(m.has("integrations.manage")).toBe(false);
    expect(DEFAULT_ROLE_META.manager.description).toContain("No Stripe, billing or API keys");
  });

  it("Front desk and Provider touch no settings", () => {
    for (const role of ["front_desk", "provider"] as const) {
      const p = DEFAULT_ROLE_PERMISSIONS[role];
      for (const a of all) expect(p.has(a), `${role} ${a}`).toBe(false);
    }
  });
});
