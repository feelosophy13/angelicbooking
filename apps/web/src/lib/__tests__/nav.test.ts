import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { navSections, searchPages } from "../nav";

/** Every sidebar entry opens a page the viewer may load: a link that ends in "Not allowed" is a bug. */
const labels = (perms: Parameters<typeof navSections>[1]) => navSections("/app/x", perms).flatMap((s) => s.items.map((i) => i.label));
const only = (...a: string[]) => new Set(a) as unknown as typeof DEFAULT_ROLE_PERMISSIONS.provider;

describe("sidebar entries match their pages", () => {
  it("a provider sees no Waitlist, Reviews are for review viewers, Classes need a calendar", () => {
    const provider = labels(DEFAULT_ROLE_PERMISSIONS.provider);
    expect(provider).not.toContain("Waitlist");
    expect(provider).toContain("Reviews"); // Provider has reviews.view.own
    expect(provider).toContain("Classes");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.front_desk)).toContain("Waitlist");
    expect(labels(only("waitlist.view"))).toContain("Waitlist");
    expect(labels(only("appointments.read.any"))).not.toContain("Waitlist");
    const noReviews = labels(only("appointments.read.own", "checkout.take", "clients.read"));
    expect(noReviews).not.toContain("Reviews");
    expect(noReviews).toContain("Classes");
    expect(labels(only("checkout.take"))).not.toContain("Classes");
  });
  it("the phase 1 view permissions open their pages: directory, schedules, menu, inventory, sales, forms", () => {
    const none = labels(only("appointments.read.own"));
    for (const l of ["Clients", "Staff", "Staff hours", "Services", "Products", "Packages", "Memberships", "Sales & checkout", "Forms", "Inventory"]) expect(none, l).not.toContain(l);
    expect(labels(only("staff.directory"))).toContain("Staff");
    expect(labels(only("staff.schedules.view"))).toContain("Staff hours");
    expect(labels(only("appointments.read.any"))).not.toContain("Staff hours");
    expect(labels(only("catalog.view"))).toEqual(expect.arrayContaining(["Services", "Products", "Packages", "Memberships"]));
    expect(labels(only("inventory.view"))).toContain("Inventory");
    expect(labels(only("inventory.log"))).toContain("Log supplies");
    expect(labels(only("sales.view.own"))).toContain("Sales & checkout");
    expect(labels(only("forms.manage"))).toContain("Forms");
    expect(labels(only("business.manage"))).not.toContain("Forms");
    expect(labels(only("clients.read"))).toContain("Clients");
  });
  it("⌘K offers New appointment, Block time and New client only to those who may (A5)", () => {
    const titles = (p: Parameters<typeof searchPages>[1], staffId: string | null = null) => searchPages("/app/x", p, staffId).map((x) => x.title);
    expect(titles(DEFAULT_ROLE_PERMISSIONS.front_desk)).toEqual(expect.arrayContaining(["New appointment", "Block time", "New client"]));
    const provider = titles(DEFAULT_ROLE_PERMISSIONS.provider, "s1");
    for (const t of ["New appointment", "Block time", "New client"]) expect(provider).not.toContain(t);
    // An own-calendar role with the "book on their own" permission, but only once linked to a staff member.
    expect(titles(only("appointments.read.own", "appointments.book.own"), "s1")).toContain("New appointment");
    expect(titles(only("appointments.read.own", "appointments.book.own"), null)).not.toContain("New appointment");
  });
  it("Marketing follows marketing.send and Automations business.manage, not reports.view", () => {
    const reportsOnly = labels(only("reports.view"));
    expect(reportsOnly).not.toContain("Marketing");
    expect(reportsOnly).not.toContain("Automations");
    expect(labels(only("marketing.send"))).toContain("Marketing");
    expect(labels(only("marketing.send"))).not.toContain("Automations");
    expect(labels(only("business.manage"))).toContain("Automations");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.manager)).toEqual(expect.arrayContaining(["Marketing", "Automations"]));
    // ⌘K: the Marketing entry already covers /marketing, so "Promo codes" is the extra that shows the gate.
    expect(searchPages("/app/x", only("reports.view")).map((p) => p.title)).not.toContain("Promo codes");
    expect(searchPages("/app/x", only("marketing.send")).map((p) => p.title)).toContain("Promo codes");
  });
  it("Gift cards are for whoever may look them up", () => {
    expect(labels(DEFAULT_ROLE_PERMISSIONS.provider)).not.toContain("Gift cards");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.front_desk)).toContain("Gift cards"); // the desk answers "what's left on my card"
    expect(labels(only("reports.view"))).not.toContain("Gift cards");
    expect(labels(only("giftcards.view"))).toContain("Gift cards");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.manager)).toContain("Gift cards");
  });
});
