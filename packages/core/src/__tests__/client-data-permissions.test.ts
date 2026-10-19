import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, can, type Action } from "../permissions";

/** "View clients" no longer implies the bulk download, texts, photos, notes or balances: each is its own permission with its own defaults. */
describe("client data permissions", () => {
  const split = ["clients.export", "clients.notes", "clients.messages", "clients.photos", "clients.balances"] as const satisfies readonly Action[];

  it("exist and are listed under Clients in the role editor", () => {
    const clients = PERMISSION_GROUPS.find((g) => g.title === "Clients")!;
    const listed = clients.items.map((i) => i.action);
    for (const a of split) {
      expect(ACTIONS).toContain(a);
      expect(listed).toContain(a);
    }
  });

  it("View clients promises only the list, contact details and history", () => {
    const view = PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.action === "clients.read")!;
    expect(view.label).toBe("View clients");
    expect(view.description.toLowerCase()).not.toContain("note");
  });

  it("Owner and Manager have all five", () => {
    for (const a of split) {
      expect(can("owner", a), a).toBe(true);
      expect(can("manager", a), a).toBe(true);
    }
  });

  it("Front desk reads notes, texts, balances and photos, but cannot download the list", () => {
    // PERMISSIONS-PLAN-2026-10-18.md section 3 gives the desk "See every visit photo" (O M F); until then the desk had none.
    const fd = DEFAULT_ROLE_PERMISSIONS.front_desk;
    expect(fd.has("clients.read")).toBe(true);
    expect(fd.has("clients.notes")).toBe(true);
    expect(fd.has("clients.messages")).toBe(true);
    expect(fd.has("clients.balances")).toBe(true);
    expect(fd.has("clients.export")).toBe(false);
    expect(fd.has("clients.photos")).toBe(true);
  });

  it("Provider opens a client with notes and photos, nothing more", () => {
    const p = DEFAULT_ROLE_PERMISSIONS.provider;
    expect(p.has("clients.read")).toBe(true);
    expect(p.has("clients.notes")).toBe(true);
    expect(p.has("clients.photos")).toBe(true);
    expect(p.has("clients.export")).toBe(false);
    expect(p.has("clients.messages")).toBe(false);
    expect(p.has("clients.balances")).toBe(false);
    expect(p.has("clients.write")).toBe(false);
  });
});
