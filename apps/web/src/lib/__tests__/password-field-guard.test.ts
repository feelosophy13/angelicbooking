import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every password field has a button to show what was typed (DESIGN.md, "Forms"). <Input type="password"> from
 * components/ui.tsx adds it, so this fails when someone writes a bare <input type="password"> instead.
 */
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("password fields", () => {
  it("always use the shared Input, which has a show / hide button", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/<input\b[^>]*type=["']password["']/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, 'use <Input type="password" /> from components/ui.tsx').toEqual([]);
  });
});
