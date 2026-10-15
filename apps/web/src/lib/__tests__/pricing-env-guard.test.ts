import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prices live in the database (the price book, edited in the admin app), never in environment variables. This fails when
 * someone reads BILLING_*, SMS_* or PLATFORM_FEE_BPS from process.env again.
 */
const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("pricing env guard", () => {
  it("never reads a price from the environment", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/process\.env\.(BILLING_[A-Z_]+|SMS_[A-Z_]+|PLATFORM_FEE_BPS)\b/.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(offenders, "read the price book (server/price-book.ts) instead").toEqual([]);
  });
});
