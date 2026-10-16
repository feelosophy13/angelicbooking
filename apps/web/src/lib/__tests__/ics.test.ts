import { describe, expect, it } from "vitest";
import { esc, fold } from "../ics";

describe("ics", () => {
  it("escapes backslashes, semicolons, commas and line breaks", () => {
    expect(esc("a;b,c\\d\ne\r\nf")).toBe(String.raw`a\;b\,c\\d\ne\nf`);
  });
  it("folds long lines at 75 octets without splitting a character", () => {
    const line = "DESCRIPTION:" + "é".repeat(60);
    const parts = fold(line).split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    expect(fold("SHORT")).toBe("SHORT");
  });
});
