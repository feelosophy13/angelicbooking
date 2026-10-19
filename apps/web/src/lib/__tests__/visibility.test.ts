import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { canOpenGiftCards, canSeeGiftCardCodes, canSeeStaffLogins, maskCode } from "../visibility";

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
