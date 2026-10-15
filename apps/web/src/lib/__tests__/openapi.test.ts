/** The committed OpenAPI file (public/openapi/v1.json) must match the route files. Run `pnpm openapi` after changing a route. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_SCOPE_NAMES } from "../api-scopes";
import { buildOpenApi } from "../openapi";

const apiDir = fileURLToPath(new URL("../../app/api/v1", import.meta.url));
const committed = JSON.parse(readFileSync(fileURLToPath(new URL("../../../public/openapi/v1.json", import.meta.url)), "utf8"));
const built = JSON.parse(JSON.stringify(buildOpenApi(apiDir)));

describe("OpenAPI spec", () => {
  it("is up to date with the route files", () => {
    expect(committed, "run `pnpm openapi` in apps/web and commit public/openapi/v1.json").toEqual(built);
  });

  it("every operation names a real scope and declares each path parameter", () => {
    for (const [path, ops] of Object.entries(built.paths) as [string, Record<string, { "x-scope": string; parameters?: { name: string; in: string }[] }>][]) {
      const declared = new Set((Object.values(ops)[0]?.parameters ?? []).filter((x) => x.in === "path").map((x) => x.name));
      for (const [method, op] of Object.entries(ops)) {
        expect(API_SCOPE_NAMES, `${method.toUpperCase()} ${path}`).toContain(op["x-scope"]);
        for (const name of path.match(/\{(\w+)\}/g)?.map((s) => s.slice(1, -1)) ?? []) {
          expect(declared.has(name), `${method.toUpperCase()} ${path} declares {${name}}`).toBe(true);
        }
      }
    }
  });

  it("the developers page documents every endpoint, with its scope, and nothing that does not exist", () => {
    // The field lists and examples on /developers are hand-written and can drift; the endpoint list and scopes are checked here.
    const docsDir = fileURLToPath(new URL("../../app/developers", import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".tsx")) sources.push(readFileSync(full, "utf8"));
      }
    };
    walk(docsDir);
    // Path parameters may be named differently in the docs ({item_id}) and the folders ({itemId}); compare the shape only.
    const shape = (method: string, path: string) => `${method.toLowerCase()} ${path.replace(/\{\w+\}/g, "{}")}`;
    const documented = new Map<string, string | undefined>();
    for (const src of sources) {
      for (const m of src.matchAll(/<Endpoint method="(\w+)" path="([^"]+)"(?: scope="([^"]+)")?/g)) {
        documented.set(shape(m[1]!, m[2]!), m[3]);
      }
    }
    const specOps = new Map<string, string>();
    for (const [path, ops] of Object.entries(built.paths) as [string, Record<string, { "x-scope": string }>][]) {
      for (const [method, op] of Object.entries(ops)) specOps.set(shape(method, path.replace(/^\/api\/v1/, "")), op["x-scope"]);
    }
    expect([...documented.keys()].filter((k) => !specOps.has(k)), "documented but not in the API").toEqual([]);
    expect([...specOps.keys()].filter((k) => !documented.has(k)), "in the API but not documented").toEqual([]);
    for (const [k, scope] of documented) {
      expect(scope, `${k} scope on /developers`).toBe(specOps.get(k));
    }
  });
});
