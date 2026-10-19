import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS } from "@angelic/core";
import { navSections, searchPages } from "../nav";

/** Every sidebar entry opens a page the viewer may load: a link that ends in "Not allowed" is a bug. */
const labels = (perms: Parameters<typeof navSections>[1]) => navSections("/app/x", perms).flatMap((s) => s.items.map((i) => i.label));
const only = (...a: string[]) => new Set(a) as unknown as typeof DEFAULT_ROLE_PERMISSIONS.provider;

describe("sidebar entries match their pages", () => {
  it("a provider sees no Waitlist, Reviews are for client viewers, Classes need a calendar", () => {
    const provider = labels(DEFAULT_ROLE_PERMISSIONS.provider);
    expect(provider).not.toContain("Waitlist");
    expect(provider).toContain("Reviews"); // Provider has clients.read
    expect(provider).toContain("Classes");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.front_desk)).toContain("Waitlist");
    const noClients = labels(only("appointments.read.own", "checkout.take"));
    expect(noClients).not.toContain("Reviews");
    expect(noClients).toContain("Classes");
    expect(labels(only("checkout.take"))).not.toContain("Classes");
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
  it("Gift cards are for issuers and reports readers", () => {
    expect(labels(DEFAULT_ROLE_PERMISSIONS.provider)).not.toContain("Gift cards");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.front_desk)).not.toContain("Gift cards");
    expect(labels(only("reports.view"))).toContain("Gift cards");
    expect(labels(DEFAULT_ROLE_PERMISSIONS.manager)).toContain("Gift cards");
  });
});
