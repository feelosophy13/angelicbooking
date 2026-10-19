import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { appointmentAccess, blockingAccess, bookingAccess, coversLine, coversWholeAppointment, seesNoCalendar, seesOwnOnly } from "../appointment-access";

const provider = DEFAULT_ROLE_PERMISSIONS.provider;
const frontDesk = DEFAULT_ROLE_PERMISSIONS.front_desk;

describe("appointmentAccess", () => {
  it("lets front desk read and change any appointment", () => {
    expect(appointmentAccess(frontDesk, "read", null, ["s1"])).toBe("any");
    expect(appointmentAccess(frontDesk, "write", null, ["s1"])).toBe("any");
  });
  it("lets a provider in only to appointments they are booked on", () => {
    expect(appointmentAccess(provider, "read", "me", ["me"])).toBe("own");
    expect(appointmentAccess(provider, "write", "me", ["me", "me"])).toBe("own");
    expect(appointmentAccess(provider, "read", "me", ["other"])).toBeNull();
  });
  it("keeps out a provider whose login is not linked to a staff member", () => {
    expect(appointmentAccess(provider, "read", null, ["s1"])).toBeNull();
  });
});

describe("a visit shared with a colleague", () => {
  const withPerm = (...extra: string[]) => new Set([...provider, ...extra]) as unknown as typeof provider;
  it("is 'shared', not 'own', when only some lines are theirs", () => {
    expect(appointmentAccess(provider, "read", "me", ["me", "other"])).toBe("shared");
    expect(appointmentAccess(provider, "write", "me", ["other", "me"])).toBe("shared");
    expect(appointmentAccess(provider, "read", "me", ["me"])).toBe("own");
    expect(appointmentAccess(frontDesk, "write", "me", ["me", "other"])).toBe("any");
  });
  it("lets them change their own lines but never cancel the visit", () => {
    const change = withPerm("appointments.change.own", "appointments.cancel.own");
    expect(appointmentAccess(change, "change", "me", ["me", "other"])).toBe("shared");
    expect(appointmentAccess(change, "cancel", "me", ["me", "other"])).toBeNull();
    expect(appointmentAccess(change, "cancel", "me", ["me"])).toBe("own");
  });
  it("reaches the whole appointment only with 'any' or 'own', and a line only when it is theirs", () => {
    expect(coversWholeAppointment("any")).toBe(true);
    expect(coversWholeAppointment("own")).toBe(true);
    expect(coversWholeAppointment("shared")).toBe(false);
    expect(coversWholeAppointment(null)).toBe(false);
    expect(coversLine("shared", "me", "me")).toBe(true);
    expect(coversLine("shared", "me", "other")).toBe(false);
    expect(coversLine("shared", "me", null)).toBe(false);
    expect(coversLine("shared", null, null)).toBe(false);
    expect(coversLine("own", "me", "other")).toBe(true); // "own" never has another's line; a stale id changes nothing
    expect(coversLine("any", null, "other")).toBe(true);
    expect(coversLine(null, "me", "me")).toBe(false);
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

describe("what the owner can switch on for a provider", () => {
  const base = [...provider];
  const withPerm = (...extra: string[]) => new Set([...base, ...extra]) as unknown as typeof provider;

  it("by default a provider can update their own appointments but not change, cancel or book", () => {
    expect(appointmentAccess(provider, "write", "me", ["me"])).toBe("own");
    expect(appointmentAccess(provider, "change", "me", ["me"])).toBeNull();
    expect(appointmentAccess(provider, "cancel", "me", ["me"])).toBeNull();
    expect(bookingAccess(provider, "me")).toBeNull();
  });
  it("each permission unlocks only its own ability, and only on their own appointments", () => {
    const change = withPerm("appointments.change.own");
    expect(appointmentAccess(change, "change", "me", ["me"])).toBe("own");
    expect(appointmentAccess(change, "change", "me", ["other"])).toBeNull();
    expect(appointmentAccess(change, "cancel", "me", ["me"])).toBeNull();
    const cancel = withPerm("appointments.cancel.own");
    expect(appointmentAccess(cancel, "cancel", "me", ["me"])).toBe("own");
    expect(appointmentAccess(cancel, "change", "me", ["me"])).toBeNull();
  });
  it("booking for themselves needs the permission and a linked staff member", () => {
    const book = withPerm("appointments.book.own");
    expect(bookingAccess(book, "me")).toBe("own");
    expect(bookingAccess(book, null)).toBeNull();
  });
  it("front desk and managers can do all of it for anyone", () => {
    for (const mode of ["write", "change", "cancel"] as const) expect(appointmentAccess(frontDesk, mode, null, ["x"])).toBe("any");
    expect(bookingAccess(frontDesk, null)).toBe("any");
    expect(bookingAccess(DEFAULT_ROLE_PERMISSIONS.manager, null)).toBe("any");
  });
});

describe("blocking time", () => {
  const withPerm = (...extra: string[]) => new Set([...provider, ...extra]) as unknown as typeof provider;
  it("is off for a provider by default and on when the owner grants it", () => {
    expect(blockingAccess(provider, "me")).toBeNull();
    expect(appointmentAccess(provider, "block", "me", ["me"])).toBeNull();
    const granted = withPerm("appointments.block.own");
    expect(blockingAccess(granted, "me")).toBe("own");
    expect(blockingAccess(granted, null)).toBeNull();
    expect(appointmentAccess(granted, "block", "me", ["me"])).toBe("own");
    expect(appointmentAccess(granted, "block", "me", ["other"])).toBeNull();
  });
  it("does not unlock the other abilities", () => {
    const granted = withPerm("appointments.block.own");
    expect(appointmentAccess(granted, "change", "me", ["me"])).toBeNull();
    expect(bookingAccess(granted, "me")).toBeNull();
  });
  it("is something front desk and managers can do for anyone", () => {
    expect(blockingAccess(frontDesk, null)).toBe("any");
    expect(blockingAccess(DEFAULT_ROLE_PERMISSIONS.manager, null)).toBe("any");
  });
});
