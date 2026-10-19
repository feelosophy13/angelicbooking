import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { canOpenGiftCards, canSeeGiftCardCodes, canSeeStaffLogins, canViewPrivateFile, maskCode } from "../visibility";

const { owner, manager, front_desk: frontDesk, provider } = DEFAULT_ROLE_PERMISSIONS;
const only = (...a: string[]) => new Set(a) as unknown as typeof provider;

describe("gift cards", () => {
  it("opens for whoever issues cards or reads reports, and codes show in full only to issuers", () => {
    expect(canOpenGiftCards(owner)).toBe(true);
    expect(canOpenGiftCards(manager)).toBe(true);
    expect(canOpenGiftCards(only("reports.view"))).toBe(true);
    expect(canOpenGiftCards(frontDesk)).toBe(false);
    expect(canOpenGiftCards(provider)).toBe(false);
    expect(canSeeGiftCardCodes(only("giftcards.issue"))).toBe(true);
    expect(canSeeGiftCardCodes(only("reports.view"))).toBe(false);
  });
  it("masks a code to its last four characters", () => {
    expect(maskCode("GC-7F3K-9Q2M")).toBe("••••9Q2M");
    expect(maskCode("ABCD")).toBe("••••ABCD");
  });
});

describe("staff directory", () => {
  it("shows emails and login status only to whoever manages staff or logins", () => {
    expect(canSeeStaffLogins(owner)).toBe(true);
    expect(canSeeStaffLogins(only("staff.manage"))).toBe(true);
    expect(canSeeStaffLogins(only("members.manage"))).toBe(true);
    expect(canSeeStaffLogins(frontDesk)).toBe(false);
    expect(canSeeStaffLogins(provider)).toBe(false);
  });
});

describe("private files", () => {
  const me = { staffId: "me" };
  it("client photos follow clients.photos; signatures and form files follow clients.notes", () => {
    expect(canViewPrivateFile("client", provider, me)).toBe(true); // Provider has photos by default
    expect(canViewPrivateFile("client", frontDesk, me)).toBe(false);
    expect(canViewPrivateFile("signature", frontDesk, me)).toBe(true); // Front desk has notes by default
    expect(canViewPrivateFile("form", only("clients.read", "clients.photos"), me)).toBe(false);
    expect(canViewPrivateFile("form", only("clients.notes"), me)).toBe(true);
  });
  it("visit photos follow the appointment: anyone with every calendar, an own-calendar role only on visits they are booked on", () => {
    expect(canViewPrivateFile("visit", frontDesk, { staffId: null }, { staffIds: ["other"] })).toBe(true);
    expect(canViewPrivateFile("visit", provider, me, { staffIds: ["me"] })).toBe(true);
    expect(canViewPrivateFile("visit", provider, me, { staffIds: ["me", "other"] })).toBe(true); // shared is still theirs to see
    expect(canViewPrivateFile("visit", provider, me, { staffIds: ["other"] })).toBe(false);
    expect(canViewPrivateFile("visit", provider, { staffId: null }, { staffIds: ["me"] })).toBe(false);
    // A photo no appointment claims opens only for "any" roles.
    expect(canViewPrivateFile("visit", provider, me, null)).toBe(false);
    expect(canViewPrivateFile("visit", manager, me, null)).toBe(true);
  });
  it("serves nothing else, whatever the permissions", () => {
    expect(canViewPrivateFile("import", owner, me)).toBe(false);
    expect(canViewPrivateFile("logo", owner, me)).toBe(false);
  });
});
