import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { canOpenGiftCards, clientForViewer, canSeeAllSales, canSeeClassSession, canSeeClientContact, canSeeClientSpend, canSeeCosts, canSeeGiftCardCodes, canSeePrices, canSeeReviews, canSeeStaffLogins, canSeeStaffSchedules, canSeeStock, canViewPrivateFile, maskCode, salesScope } from "../visibility";

const { owner, manager, front_desk: frontDesk, provider } = DEFAULT_ROLE_PERMISSIONS;
const only = (...a: string[]) => new Set(a) as unknown as typeof provider;

describe("gift cards", () => {
  it("opens with giftcards.view (the desk looks up balances), and codes show in full only to issuers", () => {
    expect(canOpenGiftCards(owner)).toBe(true);
    expect(canOpenGiftCards(manager)).toBe(true);
    expect(canOpenGiftCards(only("reports.view"))).toBe(false);
    expect(canOpenGiftCards(only("giftcards.view"))).toBe(true);
    expect(canOpenGiftCards(frontDesk)).toBe(true);
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
    expect(canViewPrivateFile("client", provider, me)).toBe(true); // Provider has their own photos by default, and a profile photo is nobody's visit
    expect(canViewPrivateFile("client", frontDesk, me)).toBe(true); // and so does the desk since the 2026-10-18 plan
    expect(canViewPrivateFile("client", only("clients.read", "clients.notes"), me)).toBe(false);
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

describe("classes", () => {
  it("shows every class to whoever sees every calendar, and an own-calendar role only their own", () => {
    expect(canSeeClassSession(frontDesk, null, "other")).toBe(true);
    expect(canSeeClassSession(provider, "me", "me")).toBe(true);
    expect(canSeeClassSession(provider, "me", "other")).toBe(false);
    expect(canSeeClassSession(provider, null, "me")).toBe(false);
    expect(canSeeClassSession(only("clients.read"), "me", "me")).toBe(false);
  });
  it("prints the roster's phone and email only with clients.contact", () => {
    expect(canSeeClientContact(frontDesk)).toBe(true);
    expect(canSeeClientContact(provider)).toBe(false);
    expect(canSeeClientContact(only("clients.read"))).toBe(false);
    expect(canSeeClientContact(only("clients.contact"))).toBe(true);
  });
});

describe("the phase 1 view permissions (PERMISSIONS-PLAN-2026-10-18.md section 3)", () => {
  it("each helper answers from its own permission, never a role name", () => {
    expect(canSeeClientSpend(frontDesk)).toBe(true);
    expect(canSeeClientSpend(provider)).toBe(false);
    expect(canSeeStaffSchedules(frontDesk)).toBe(true);
    expect(canSeeStaffSchedules(provider)).toBe(false);
    expect(canSeeStaffSchedules(only("appointments.read.any"))).toBe(false);
    expect(canSeePrices(provider)).toBe(true);
    expect(canSeePrices(only("catalog.view"))).toBe(false);
    expect(canSeeCosts(manager)).toBe(true);
    expect(canSeeCosts(frontDesk)).toBe(false);
    expect(canSeeStock(frontDesk)).toBe(true);
    expect(canSeeStock(provider)).toBe(false);
    expect(canSeeAllSales(frontDesk)).toBe(true);
    expect(canSeeAllSales(provider)).toBe(false);
  });
  it("reviews and sales answer own, all or nothing", () => {
    expect(canSeeReviews(manager)).toBe("all");
    expect(canSeeReviews(provider)).toBe("own");
    expect(canSeeReviews(only("clients.read"))).toBeNull();
    expect(salesScope(frontDesk)).toBe("all");
    expect(salesScope(provider)).toBe("own");
    // Taking payments alone works like "own": the ticket they ring up is theirs to finish.
    expect(salesScope(only("checkout.take"))).toBe("own");
    expect(salesScope(only("reports.view"))).toBeNull();
  });
});

describe("a client in the mobile appointment detail", () => {
  const client = { id: "c1", firstName: "Ana", lastName: "Lee", phone: "+15555550100", email: "ana@example.com", notes: "allergic to latex", birthday: "1990-01-01", tags: ["vip"] };
  it("is only a name without clients.contact, plus the private notes when clients.notes is held", () => {
    expect(clientForViewer(client, only("appointments.read.own", "appointments.write.own"))).toEqual({ id: "c1", firstName: "Ana", lastName: "Lee" });
    expect(clientForViewer(client, only("clients.read"))).toEqual({ id: "c1", firstName: "Ana", lastName: "Lee" });
    expect(clientForViewer(client, provider)).toEqual({ id: "c1", firstName: "Ana", lastName: "Lee", notes: "allergic to latex" });
  });
  it("keeps contact details but drops private notes without clients.notes", () => {
    const seen = clientForViewer(client, only("clients.contact"))!;
    expect(seen).toMatchObject({ phone: "+15555550100", email: "ana@example.com", birthday: "1990-01-01" });
    expect(seen).not.toHaveProperty("notes");
  });
  it("is complete with both, and null stays null", () => {
    expect(clientForViewer(client, only("clients.contact", "clients.notes"))).toEqual(client);
    expect(clientForViewer(client, frontDesk)).toEqual(client); // Front desk: contact + notes by default
    expect(clientForViewer(null, owner)).toBeNull();
  });
});
