import { describe, expect, it } from "vitest";
import { formatLashThickness, formatLashZone, LashMapError, parseLashZones, starterLashZones } from "../lash-map";

const zone = (length: unknown, curl: unknown, thickness: unknown) => ({ length, curl, thickness });

describe("parseLashZones", () => {
  it("accepts 6 or 7 zones and normalises curl and thickness", () => {
    const z = parseLashZones([zone(8, "c", "0.07"), zone(9.5, "CC", 0.1), zone(10, "d", 0.05), zone(11, "L+", 0.15), zone(12, "C", 0.07), zone("", "", "")]);
    expect(z[0]).toEqual({ length: 8, curl: "C", thickness: 0.07 });
    expect(z[1]?.length).toBe(9.5);
    expect(z[5]).toEqual({ length: null, curl: null, thickness: null });
    expect(parseLashZones(starterLashZones(7))).toHaveLength(7);
  });
  it("rejects other zone counts, all-blank maps and out-of-range values", () => {
    expect(() => parseLashZones(starterLashZones(6).slice(0, 5))).toThrow(LashMapError);
    expect(() => parseLashZones(Array.from({ length: 6 }, () => zone(null, null, null)))).toThrow(/at least one/);
    const bad = (z: object) => { const zs: object[] = starterLashZones(6); zs[2] = z; return () => parseLashZones(zs); };
    expect(bad(zone(25, "C", 0.07))).toThrow(/Zone 3: length/);
    expect(bad(zone(10.3, "C", 0.07))).toThrow(/half-millimetre/);
    expect(bad(zone(10, "C", 0.25))).toThrow(/Zone 3: thickness/);
    expect(bad(zone(10, "C", 0.01))).toThrow(/thickness/);
    expect(bad(zone(10, "<b>", 0.07))).toThrow(/curl/);
  });
});

describe("formatting", () => {
  it("writes thickness the way lash trays do", () => {
    expect(formatLashThickness(0.07)).toBe(".07");
    expect(formatLashThickness(0.1)).toBe(".10");
    expect(formatLashThickness(0.035)).toBe(".035");
    expect(formatLashZone({ length: 11, curl: "CC", thickness: 0.05 })).toBe("11mm CC .05");
    expect(formatLashZone({ length: null, curl: null, thickness: null })).toBe("—");
  });
});
