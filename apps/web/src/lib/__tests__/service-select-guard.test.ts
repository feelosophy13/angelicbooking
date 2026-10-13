import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A menu can have hundreds of services, so a plain <select> listing them all is overwhelming (DESIGN.md, "Choosing a
 * service"). Pages choose or filter by service with ServicePicker (search plus category groups). This fails when someone
 * maps a services list straight into <option>s.
 */
const SRC = join(__dirname, "..", "..");
const ALLOWED: Record<string, string> = {
  // A studio runs a handful of group classes, never hundreds; the list is naturally short.
  "app/app/[slug]/classes/new/page.tsx": "group classes only",
};
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("service selects", () => {
  it("never list every service in a plain select", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED[rel]) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/\b\w*[sS]ervices\w*\.map\(.*<option/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, "use <ServicePicker> (components/service-picker.tsx) with serviceGroups() instead of a long <select>").toEqual([]);
  });
});
