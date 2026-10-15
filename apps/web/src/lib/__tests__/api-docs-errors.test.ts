/**
 * Every error code the API can return must appear in the error table on /developers. Codes are read from the source, so a new one
 * added to a route without a docs line fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url)); // apps/web/src

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

describe("error codes on /developers", () => {
  it("documents every code the API returns", () => {
    const apiFiles = [...sources(join(root, "app/api/v1")), ...sources(join(root, "server")).filter((f) => /api-v1/.test(f)), join(root, "lib/api.ts")];
    const emitted = new Set<string>();
    for (const file of apiFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/apiError\(\d+, "([a-z_]+)"/g)) emitted.add(m[1]!);
      // Response bodies carry `code:`; zod's addIssue({ code: "custom" }) is validation plumbing, not an API error.
      for (const line of src.split("\n")) {
        if (line.includes("addIssue")) continue;
        for (const m of line.matchAll(/\bcode: "([a-z_]+)"/g)) emitted.add(m[1]!);
      }
    }
    // Helpers that build their own error response.
    for (const code of ["not_found", "validation_failed", "conflict"]) emitted.add(code);

    const docs = readFileSync(join(root, "app/developers/page.tsx"), "utf8");
    const missing = [...emitted].filter((code) => !docs.includes(code));
    expect(missing, "error codes the API returns that /developers does not list").toEqual([]);
  });
});
