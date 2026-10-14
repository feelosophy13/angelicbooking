import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Businesses make up their own roles ("Stylist", "Assistant", "Receptionist"), so behaviour must follow what a role can do (its permissions),
 * never what it is called. The only place built-in role names belong is where the defaults are defined.
 */
const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set(["lib/auth.ts"]); // seeds the four built-in roles when a business is created
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("role names", () => {
  it("are never what decides behaviour", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/\b(role|key|roleKey)\s*[!=]==?\s*"(provider|front_desk|manager)"/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, "decide from permissions (can(...), worksOwnCalendar(...)), not from the role's name").toEqual([]);
  });
});
