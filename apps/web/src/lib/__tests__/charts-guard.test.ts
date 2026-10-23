import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Treatment charts are clinical records for the team. They are never on the public booking site, the embed, a client's own account,
 * the public API or the mobile API: none of that code may read the chart tables or the charts module. A new path that needs charts
 * gets its own permission check and a line here saying why.
 */
const SRC = join(__dirname, "..", "..");
const PUBLIC = ["app/book", "app/embed", "app/account", "app/(auth)", "app/invite", "app/unsubscribe", "app/api", "app/developers", "server/public-booking.ts", "server/booking.ts", "server/client-auth.ts", "lib/openapi.ts"];
const isApiV1 = (rel: string) => /^server\/api-v1/.test(rel);
const TOUCHES = /@\/server\/charts|chartNotes|chartAddenda|chartTemplates|chart_notes|chart_addenda|chart_templates/;

function walk(p: string, out: string[] = []) {
  if (statSync(p).isDirectory()) { for (const n of readdirSync(p)) if (n !== "__tests__") walk(join(p, n), out); }
  else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  return out;
}

describe("charts stay private", () => {
  it("no public, client-facing or API code reads charts", () => {
    const files = [...PUBLIC.flatMap((p) => { try { return walk(join(SRC, p)); } catch { return []; } }), ...walk(join(SRC, "server")).filter((f) => isApiV1(relative(SRC, f)))];
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => TOUCHES.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
  it("every page and action that reads charts checks the charts permissions", () => {
    // Type-only imports read nothing.
    const users = walk(join(SRC, "app")).filter((f) => /^import (?!type )[^;]*from "@\/server\/charts"/m.test(readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThan(3);
    for (const f of users) {
      const src = readFileSync(f, "utf8");
      // Either the charts permissions themselves, or the per-client check that applies them (or forms.manage for the template pages).
      expect(/charts\.(read|write)\.|canChartClient|forms\.manage/.test(src), relative(SRC, f)).toBe(true);
    }
  });
});
