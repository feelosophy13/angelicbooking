import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every uploaded picture must go through optimizeUpload (lib/images.ts) before it is stored. These checks fail
 * when someone writes upload bytes to storage some other way, so the rule in DESIGN.md cannot quietly erode.
 */
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));

describe("upload guard", () => {
  it("only lib/files.ts writes upload bytes into the files table (plus the staged CSV import, which is not a picture)", () => {
    const writers = files.filter((f) => /insert\(schema\.files\)/.test(f.text)).map((f) => f.path).sort();
    expect(writers).toEqual(["app/app/[slug]/settings/import/actions.ts", "lib/files.ts"]);
  });
  it("every store function in lib/files.ts calls optimizeUpload", () => {
    const text = files.find((f) => f.path === "lib/files.ts")!.text;
    for (const fn of ["storeImage", "storeFormFile", "storeSignaturePng", "storeVisitPhoto", "storeBookingPhoto"]) {
      const body = text.slice(text.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf("\n}\n")), fn).toContain("optimizeUpload(");
    }
  });
  it("nothing else puts bytes in object storage", () => {
    const writers = files.filter((f) => /\bputObject\(/.test(f.text)).map((f) => f.path).sort();
    expect(writers).toEqual(["lib/files.ts", "lib/object-storage.ts", "server/files-to-r2.ts"]);
  });
  it("the migration optimizes before it stores", () => {
    expect(files.find((f) => f.path === "server/files-to-r2.ts")!.text).toContain("optimizeUpload(");
  });
});
