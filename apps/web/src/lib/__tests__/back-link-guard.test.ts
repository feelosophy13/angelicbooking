import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sub-pages go back with <BackLink> above the title (DESIGN.md, "Page anatomy"), which also returns to the page the person came from.
 * A hand-written "← Something" link tucked into the header drifts to the wrong side and ignores history; this fails when one appears.
 */
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("back links", () => {
  it("are never hand-written", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel === "components/ui.tsx") continue; // BackLink itself
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/>\s*(←|&larr;)\s/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, "use <BackLink href=…>Parent</BackLink> above the PageHeader").toEqual([]);
  });
});
