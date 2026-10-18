import { describe, expect, it } from "vitest";
import { isDemoSlug, numberUsableFor } from "../demo";

describe("isDemoSlug", () => {
  it("recognises the demo tenants", () => {
    expect(isDemoSlug("demo-salon")).toBe(true);
    expect(isDemoSlug("demo-twosites")).toBe(true);
  });
  it("does not match real businesses", () => {
    expect(isDemoSlug("angelic-salon")).toBe(false);
    expect(isDemoSlug("demonstration")).toBe(false);
    expect(isDemoSlug("my-demo-salon")).toBe(false);
    expect(isDemoSlug(null)).toBe(false);
    expect(isDemoSlug("")).toBe(false);
  });
});

describe("numberUsableFor", () => {
  it("needs a verified number for a real business but any held number for a demo", () => {
    expect(numberUsableFor("angelic-salon", "verified")).toBe(true);
    expect(numberUsableFor("angelic-salon", "unverified")).toBe(false);
    expect(numberUsableFor("demo-twosites", "unverified")).toBe(true);
    expect(numberUsableFor("demo-twosites", "pending_review")).toBe(true);
    expect(numberUsableFor("demo-twosites", "released")).toBe(false);
  });
});
