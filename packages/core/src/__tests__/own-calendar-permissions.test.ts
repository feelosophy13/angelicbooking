import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS } from "../permissions";

describe("own-calendar permissions", () => {
  const own = ["appointments.book.own", "appointments.change.own", "appointments.cancel.own"] as const;

  it("exist and appear in the role editor", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.action));
    for (const a of own) {
      expect(ACTIONS).toContain(a);
      expect(listed).toContain(a);
    }
  });
  it("are off for Provider by default, so the owner has to choose to grant them", () => {
    for (const a of own) expect(DEFAULT_ROLE_PERMISSIONS.provider.has(a)).toBe(false);
  });
  it("every action is described in the role editor", () => {
    const listed = new Set(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.action)));
    for (const a of ACTIONS) expect(listed.has(a), a).toBe(true);
  });
});
