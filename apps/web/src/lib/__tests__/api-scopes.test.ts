import { describe, expect, it } from "vitest";
import { hasScope, isApiScope } from "../api-scopes";
import { generateKey, hashKey } from "../api";

describe("api scopes", () => {
  it("write implies read, never the reverse, and never across resources", () => {
    expect(hasScope(["clients:write"], "clients:read")).toBe(true);
    expect(hasScope(["clients:read"], "clients:write")).toBe(false);
    expect(hasScope(["clients:write"], "appointments:read")).toBe(false);
    expect(hasScope([], "catalog:read")).toBe(false);
    expect(hasScope(["*", "admin"], "clients:read")).toBe(false);
  });
  it("only known scopes are accepted", () => {
    expect(isApiScope("sales:read")).toBe(true);
    expect(isApiScope("sales:write")).toBe(false);
    expect(isApiScope("__proto__")).toBe(false);
  });
});

describe("api keys", () => {
  it("are long, unique and stored only as a hash", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith("ab_live_")).toBe(true);
    expect(a.key.length).toBeGreaterThan(40);
    expect(a.hash).toBe(hashKey(a.key));
    expect(a.hash).not.toContain(a.key);
    expect(a.prefix.length).toBeLessThan(a.key.length / 2);
  });
});
