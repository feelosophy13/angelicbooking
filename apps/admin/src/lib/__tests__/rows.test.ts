import { describe, expect, it } from "vitest";
import { revive } from "../rows";

describe("revive", () => {
  it("turns timestamp strings into Dates, keeps nulls and existing Dates, leaves other columns alone", () => {
    const d = new Date("2026-10-01T00:00:00Z");
    const [r] = revive<{ a: Date; b: Date | null; c: Date; n: number }>([{ a: "2026-10-14 17:43:54.918+00", b: null, c: d, n: 3 }], ["a", "b", "c"]);
    expect(r!.a).toBeInstanceOf(Date);
    expect(r!.a.getTime()).toBe(Date.parse("2026-10-14T17:43:54.918Z"));
    expect(r!.b).toBeNull();
    expect(r!.c).toBe(d);
    expect(r!.n).toBe(3);
  });
});
