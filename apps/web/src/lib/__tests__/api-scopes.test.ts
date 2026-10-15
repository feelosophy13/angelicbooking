import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { API_SCOPE_NAMES, expandScopes, hasScope, ipAllowed, isApiScope, isValidIpEntry, LEGACY_SCOPES } from "../api-scopes";
import { generateKey, hashKey } from "../api";

describe("api scopes", () => {
  it("are exact: write never includes read, and nothing crosses resources", () => {
    expect(hasScope(["clients:write"], "clients:read")).toBe(false);
    expect(hasScope(["clients:read"], "clients:write")).toBe(false);
    expect(hasScope(["clients:write"], "appointments:read")).toBe(false);
    expect(hasScope(["clients:write", "clients:read"], "clients:read")).toBe(true);
    expect(hasScope([], "catalog:read")).toBe(false);
    expect(hasScope(["*", "admin"], "clients:read")).toBe(false);
  });
  it("only known scopes are accepted", () => {
    expect(isApiScope("sales:read")).toBe(true);
    expect(isApiScope("sales:write")).toBe(false);
    expect(isApiScope("campaigns:send")).toBe(true);
    expect(isApiScope("__proto__")).toBe(false);
  });
  it("every scope is used by at least one route, and every route uses a known scope", () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (n === "route.ts") for (const m of readFileSync(full, "utf8").matchAll(/export const [A-Z]+ = route(?:<[^>]*>)?\(\s*"([a-z-]+:[a-z]+)"/g)) used.add(m[1]!);
      }
    };
    walk(join(__dirname, "../../app/api/v1"));
    for (const s of used) expect(API_SCOPE_NAMES, `route uses ${s}`).toContain(s);
    // Scopes that only gate a field of another route (not a route of their own) are listed here.
    const fieldOnly = ["pricing:write", "clients:consent", "clients:balances"];
    for (const s of API_SCOPE_NAMES) if (!fieldOnly.includes(s)) expect(used.has(s), `${s} gates a route`).toBe(true);
  });
});

describe("older keys (scope version 1)", () => {
  it("expand each old scope to what it used to allow, write including read", () => {
    const has = (stored: string[], need: string) => expandScopes(stored, 1).includes(need as never);
    expect(has(["clients:write"], "clients:read")).toBe(true);
    expect(has(["clients:write"], "clients:consent")).toBe(true);
    expect(has(["clients:write"], "client-notes:delete")).toBe(true);
    expect(has(["clients:read"], "client-notes:read")).toBe(true);
    expect(has(["clients:read"], "clients:write")).toBe(false);
    expect(has(["marketing:write"], "campaigns:send")).toBe(true);
    expect(has(["settings:write"], "policies:write")).toBe(true);
    expect(has(["appointments:write"], "appointments:cancel")).toBe(true);
    expect(has(["inventory:read"], "inventory:write")).toBe(false);
    expect(has(["inventory:read"], "supplies:write")).toBe(false); // reading supplies, not logging them
    expect(has(["catalog:read"], "pricing:write")).toBe(false);
  });
  it("drop scopes nobody knows, and never invent write from read", () => {
    expect(expandScopes(["nonsense", "x:write", "__proto__"], 1)).toEqual([]);
    for (const [old, expanded] of Object.entries(LEGACY_SCOPES)) {
      if (old.endsWith(":read")) expect(expanded.every((x) => !x.endsWith(":write") && !x.endsWith(":delete") && !x.endsWith(":send")), old).toBe(true);
    }
  });
  it("version 2 keys hold exactly what is stored", () => {
    expect(expandScopes(["clients:write", "bogus"], 2)).toEqual(["clients:write"]);
    expect(expandScopes(["clients:write"], 2)).not.toContain("clients:read");
  });
});

describe("allowed addresses", () => {
  it("an empty list allows anything; otherwise exact addresses and IPv4 ranges", () => {
    expect(ipAllowed([], "1.2.3.4")).toBe(true);
    expect(ipAllowed(["203.0.113.7"], "203.0.113.7")).toBe(true);
    expect(ipAllowed(["203.0.113.7"], "203.0.113.8")).toBe(false);
    expect(ipAllowed(["203.0.113.0/24"], "203.0.113.200")).toBe(true);
    expect(ipAllowed(["203.0.113.0/24"], "203.0.114.1")).toBe(false);
    expect(ipAllowed(["10.0.0.0/8", "203.0.113.7"], "10.9.9.9")).toBe(true);
    expect(ipAllowed(["0.0.0.0/0"], "8.8.8.8")).toBe(true);
    expect(ipAllowed(["2001:db8::1"], "2001:db8::1")).toBe(true);
    expect(ipAllowed(["203.0.113.0/24"], "local")).toBe(false);
  });
  it("validates what is typed in the form", () => {
    for (const ok of ["203.0.113.7", "203.0.113.0/24", "2001:db8::1", "0.0.0.0/0"]) expect(isValidIpEntry(ok), ok).toBe(true);
    for (const bad of ["", "999.1.1.1", "203.0.113.0/33", "203.0.113.0/", "hello", "1.2.3", "203.0.113.0/24/1", "2001:db8::1/64"]) expect(isValidIpEntry(bad), bad).toBe(false);
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
