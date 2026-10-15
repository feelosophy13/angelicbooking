/** The committed OpenAPI file (public/openapi/v1.json) must match the route files. Run `pnpm openapi` after changing a route. */
import { readFileSync } from "node:fs";
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
});
