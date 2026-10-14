import { describe, expect, it } from "vitest";
import { ACTIONS, APPOINTMENT_CAPABILITIES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, worksOwnCalendar } from "../permissions";

/** These hold for every capability, present and future, so adding one to the table is covered without writing a new test. */
describe("appointment capabilities", () => {
  const listed = new Set(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.action)));

  for (const [name, cap] of Object.entries(APPOINTMENT_CAPABILITIES)) {
    describe(name, () => {
      it("uses real permissions that the role editor lists", () => {
        for (const a of [cap.any, cap.own]) {
          expect(ACTIONS).toContain(a);
          expect(listed.has(a)).toBe(true);
        }
      });
      it("is covered, for everyone, by the owner and manager defaults", () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner.has(cap.any)).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.manager.has(cap.any)).toBe(true);
      });
    });
  }

  it("leaves everything beyond seeing and updating off for Provider, so the owner chooses", () => {
    for (const name of ["change", "cancel", "block", "book"] as const) expect(DEFAULT_ROLE_PERMISSIONS.provider.has(APPOINTMENT_CAPABILITIES[name].own)).toBe(false);
    for (const name of ["read", "write"] as const) expect(DEFAULT_ROLE_PERMISSIONS.provider.has(APPOINTMENT_CAPABILITIES[name].own)).toBe(true);
  });
});

describe("worksOwnCalendar", () => {
  it("is decided by permissions, not role names", () => {
    expect(worksOwnCalendar(DEFAULT_ROLE_PERMISSIONS.provider)).toBe(true);
    expect(worksOwnCalendar(DEFAULT_ROLE_PERMISSIONS.front_desk)).toBe(false);
    expect(worksOwnCalendar(DEFAULT_ROLE_PERMISSIONS.manager)).toBe(false);
    expect(worksOwnCalendar(DEFAULT_ROLE_PERMISSIONS.owner)).toBe(false);
    // A role a business invents ("Stylist") that sees only its own calendar:
    expect(worksOwnCalendar(new Set(["appointments.read.own", "clients.read"]))).toBe(true);
    // One that can see everyone's, however it is named:
    expect(worksOwnCalendar(new Set(["appointments.read.own", "appointments.read.any"]))).toBe(false);
    expect(worksOwnCalendar(new Set(["clients.read"]))).toBe(false);
  });
});
