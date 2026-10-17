import { describe, expect, it } from "vitest";
import { checkHostname, dnsAdvice, looksApex, normalizeHostname, platformDomains } from "../custom-domain";

const platform = ["angelicbooking.com"];

describe("normalizeHostname", () => {
  it("strips protocol, path, port, case and a trailing dot", () => {
    expect(normalizeHostname(" HTTPS://Book.MySalon.com:443/x?y=1 ")).toBe("book.mysalon.com");
    expect(normalizeHostname("book.mysalon.com.")).toBe("book.mysalon.com");
  });
});

describe("checkHostname", () => {
  it("accepts ordinary hostnames", () => {
    expect(checkHostname("book.yoursalon.com", platform)).toEqual({ ok: true, host: "book.yoursalon.com" });
    expect(checkHostname("https://Yoursalon.co.uk/", platform)).toEqual({ ok: true, host: "yoursalon.co.uk" });
  });
  it("rejects blanks, single words, IPs, bad characters and local or Render names", () => {
    for (const bad of ["", "salon", "192.168.1.1", "book_salon.com", "-x.com", "a..com", "localhost", "x.local", "my-app.onrender.com", "x.com.", "book.salon.c", "salon.123"]) {
      if (bad === "x.com.") continue; // the trailing dot is normalised away, so this one is valid
      expect(checkHostname(bad, platform).ok, bad).toBe(false);
    }
  });
  it("blocks the platform's own domain and its subdomains", () => {
    for (const bad of ["angelicbooking.com", "admin.angelicbooking.com", "app.angelicbooking.com", "x.y.angelicbooking.com"]) expect(checkHostname(bad, platform).ok, bad).toBe(false);
    expect(checkHostname("angelicbooking.net", platform).ok).toBe(true);
  });
});

describe("platformDomains", () => {
  it("adds the app host's own registrable domain", () => {
    expect(platformDomains("https://app.example.org")).toEqual(["angelicbooking.com", "example.org"]);
    expect(platformDomains("http://localhost:3001")).toEqual(["angelicbooking.com"]);
  });
});

describe("dnsAdvice", () => {
  const o = { cnameTarget: "angelic-booking.onrender.com", apexIp: "216.24.57.1" };
  it("gives a CNAME for a sub-name and an A record for a bare domain", () => {
    expect(dnsAdvice("book.yoursalon.com", o)).toMatchObject({ type: "CNAME", name: "book", value: "angelic-booking.onrender.com" });
    expect(dnsAdvice("a.b.yoursalon.com", o)).toMatchObject({ type: "CNAME", name: "a.b" });
    expect(dnsAdvice("yoursalon.com", o)).toMatchObject({ type: "A", name: "@", value: "216.24.57.1" });
    expect(dnsAdvice("shop.yoursalon.co.uk", o)).toMatchObject({ type: "CNAME", name: "shop" });
    expect(dnsAdvice("yoursalon.co.uk", o)).toMatchObject({ type: "A" });
    expect(looksApex("yoursalon.com")).toBe(true);
  });
});

import { dnsProblem, parseRenderDomain } from "../custom-domain";

describe("parseRenderDomain", () => {
  it("picks our hostname out of a list, or reads one object", () => {
    const list = [{ id: "cdm-1", name: "www.x.com", verificationStatus: "unverified" }, { id: "cdm-2", name: "x.com", verificationStatus: "verified", domainType: "apex" }];
    expect(parseRenderDomain(list, "x.com")).toEqual({ id: "cdm-2", name: "x.com", verified: true, apex: true });
    expect(parseRenderDomain({ id: "cdm-3", name: "book.x.com", verificationStatus: "unverified", domainType: "subdomain" }, "book.x.com")).toEqual({ id: "cdm-3", name: "book.x.com", verified: false, apex: false });
    expect(parseRenderDomain([{ cursor: "c", customDomain: { id: "cdm-9", name: "y.com", verificationStatus: "verified", domainType: "subdomain" } }], "y.com")).toEqual({ id: "cdm-9", name: "y.com", verified: true, apex: false });
    expect(parseRenderDomain({ message: "nope" }, "x.com")).toBeNull();
    expect(parseRenderDomain(null, "x.com")).toBeNull();
  });
});

describe("dnsProblem", () => {
  const o = { host: "book.x.com", cnameTarget: "angelic-booking.onrender.com", seenCname: [] as string[], seenA: [] as string[], apexIp: "216.24.57.1", apex: false };
  it("is quiet when the record is right, and names what is wrong otherwise", () => {
    expect(dnsProblem({ ...o, seenCname: ["Angelic-Booking.onrender.com."] })).toBeNull();
    expect(dnsProblem({ ...o, seenCname: ["other.example.com"] })).toMatch(/points at other\.example\.com/);
    expect(dnsProblem({ ...o, seenA: ["1.2.3.4"] })).toMatch(/needs a CNAME/);
    expect(dnsProblem(o)).toMatch(/can't see a CNAME/);
    expect(dnsProblem({ ...o, host: "x.com", apex: true, seenA: ["216.24.57.1"] })).toBeNull();
    expect(dnsProblem({ ...o, host: "x.com", apex: true, seenA: ["9.9.9.9"] })).toMatch(/should point at 216\.24\.57\.1/);
  });
});

describe("ownershipRecord", () => {
  it("names the TXT record relative to the domain, like the CNAME", async () => {
    const { ownershipRecord } = await import("../custom-domain");
    expect(ownershipRecord("book.mysalon.com", "abc")).toEqual({ type: "TXT", name: "_angelic-verify.book", fqdn: "_angelic-verify.book.mysalon.com", value: "angelic-verify=abc" });
    expect(ownershipRecord("mysalon.co.uk", "abc").name).toBe("_angelic-verify");
  });
});

describe("siteUrl", () => {
  it("links to the salon's own domain once it is live, ours otherwise", async () => {
    const { siteUrl } = await import("../site-url");
    expect(siteUrl({ slug: "luxe", customDomain: "book.luxe.com", customDomainStatus: "active" }, "/manage/t1")).toBe("https://book.luxe.com/book/luxe/manage/t1");
    expect(siteUrl({ slug: "luxe", customDomain: "book.luxe.com", customDomainStatus: "pending" }, "/manage/t1")).toMatch(/\/book\/luxe\/manage\/t1$/);
    expect(siteUrl({ slug: "luxe", customDomain: "book.luxe.com", customDomainStatus: "pending" })).not.toContain("book.luxe.com");
  });
});
