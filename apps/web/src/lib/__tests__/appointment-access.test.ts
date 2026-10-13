import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { appointmentAccess, seesNoCalendar, seesOwnOnly } from "../appointment-access";

const provider = DEFAULT_ROLE_PERMISSIONS.provider;
const frontDesk = DEFAULT_ROLE_PERMISSIONS.front_desk;

describe("appointmentAccess", () => {
  it("lets front desk read and change any appointment", () => {
    expect(appointmentAccess(frontDesk, "read", null, ["s1"])).toBe("any");
    expect(appointmentAccess(frontDesk, "write", null, ["s1"])).toBe("any");
  });
  it("lets a provider in only to appointments they are booked on", () => {
    expect(appointmentAccess(provider, "read", "me", ["me", "other"])).toBe("own");
    expect(appointmentAccess(provider, "write", "me", ["me"])).toBe("own");
    expect(appointmentAccess(provider, "read", "me", ["other"])).toBeNull();
  });
  it("keeps out a provider whose login is not linked to a staff member", () => {
    expect(appointmentAccess(provider, "read", null, ["s1"])).toBeNull();
  });
});

describe("what the calendar shows", () => {
  it("a provider sees only their own; front desk sees everyone", () => {
    expect(seesOwnOnly(provider)).toBe(true);
    expect(seesOwnOnly(frontDesk)).toBe(false);
    expect(seesOwnOnly(DEFAULT_ROLE_PERMISSIONS.owner)).toBe(false);
  });
  it("a role with neither permission sees no calendar", () => {
    expect(seesNoCalendar(new Set(["clients.read"]))).toBe(true);
    expect(seesNoCalendar(provider)).toBe(false);
  });
});
