import { describe, expect, it } from "vitest";
import { isDemoSlug } from "../demo";

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
