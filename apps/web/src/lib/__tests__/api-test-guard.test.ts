import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * API integration tests must load the repo .env BEFORE @angelic/db: otherwise the database client connects as the operating-system user (a
 * superuser), row-level security is silently off, and the isolation checks pass while seeing every tenant's data (and writing to them).
 */
describe("api test files", () => {
  const dir = __dirname;
  for (const f of readdirSync(dir).filter((n) => /^api-.*\.test\.ts$/.test(n) && n !== "api-test-guard.test.ts" && n !== "api-scopes.test.ts")) {
    it(`${f} imports the env file before the database`, () => {
      const lines = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.startsWith("import "));
      expect(lines[0]).toMatch(/packages\/db\/src\/env/);
    });
  }
});
