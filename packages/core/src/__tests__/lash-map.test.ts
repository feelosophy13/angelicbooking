import { describe, expect, it } from "vitest";
import { allLashFlat, formatLashThickness, formatLashType, formatLashZone, lashColorSummary, lashHybridFan, LASH_LENGTH_STYLES, lashLengthStyle, LashMapError, newLashSpike, normalizeLashZones, parseLashZones, sharedLashType, starterLashZones } from "../lash-map";

const zone = (length: unknown, curl: unknown, thickness: unknown) => ({ length, curl, thickness });

describe("parseLashZones", () => {
  it("accepts 6 or 7 zones and normalises curl and thickness", () => {
    const z = parseLashZones([zone(8, "c", "0.07"), zone(9.5, "CC", 0.1), zone(10, "d", 0.05), zone(11, "L+", 0.15), zone(12, "C", 0.07), zone("", "", "")]);
    expect(z[0]).toEqual({ length: 8, curl: "C", thickness: 0.07, flat: false, type: null, color: null, spike: null });
    expect(z[1]?.length).toBe(9.5);
    expect(z[5]).toEqual({ length: null, curl: null, thickness: null, flat: false, type: null, color: null, spike: null });
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

describe("types and spikes", () => {
  it("keeps a valid type and spikes on dividers, and drops a spike on the last zone", () => {
    const zs: object[] = starterLashZones(6).map((x) => ({ ...x, type: "3D" }));
    zs[2] = { ...zs[2], spike: { length: 14, curl: "d", thickness: 0.05, type: "Classic" } };
    zs[5] = { ...zs[5], spike: { length: 15 } };
    const z = parseLashZones(zs);
    expect(z[2]?.spike).toEqual({ length: 14, curl: "D", thickness: 0.05, flat: false, type: "Classic", color: null });
    expect(z[5]?.spike).toBeNull();
    expect(sharedLashType(z)).toBe("3D");
  });
  it("rejects unknown types and spikes without a length, naming the divider", () => {
    const withType = starterLashZones(6).map((x, i) => (i === 1 ? { ...x, type: "Mega" } : x));
    expect(() => parseLashZones(withType)).toThrow(/Zone 2: type/);
    const withSpike = starterLashZones(7).map((x, i) => (i === 3 ? { ...x, spike: { length: null, curl: "C" } } : x));
    expect(() => parseLashZones(withSpike)).toThrow(/Spike between zones 4 and 5: give it a length/);
    const tooLong = starterLashZones(7).map((x, i) => (i === 3 ? { ...x, spike: { length: 22 } } : x));
    expect(() => parseLashZones(tooLong)).toThrow(/Spike between zones 4 and 5: length/);
  });
  it("starts a new spike longer than its neighbours, capped at the maximum", () => {
    const zs = starterLashZones(6); // 8 9 10 11 12 11
    expect(newLashSpike(zs, 3)).toMatchObject({ length: 14, curl: "C", thickness: 0.07, type: "Spike" });
    expect(newLashSpike(zs.map((x) => ({ ...x, length: 19.5 })), 0).length).toBe(20);
  });
  it("only reports a shared type when every zone has the same one", () => {
    expect(sharedLashType(starterLashZones(6))).toBeNull();
    expect(sharedLashType(starterLashZones(6).map((x, i) => ({ ...x, type: i ? "Hybrid" : "Classic" })))).toBeNull();
    expect(formatLashType("5D")).toBe("5D volume");
    expect(formatLashType("Hybrid")).toBe("Hybrid");
  });
});

describe("premade fans and colour", () => {
  it("accepts premade, flat and spike types and normalises colour, with blank and black both meaning black", () => {
    const zs: object[] = starterLashZones(6).map((x, i) => ({ ...x, type: ["YY", "3D W", "Classic", "6D W", "Spike", "Hybrid"][i], color: ["", "black", "brown", " dark   brown ", "Blue", null][i] }));
    const z = parseLashZones(zs);
    expect(z.map((x) => x.type)).toEqual(["YY", "3D W", "Classic", "6D W", "Spike", "Hybrid"]);
    expect(z.map((x) => x.color)).toEqual([null, null, "Brown", "Dark brown", "Blue", null]);
    expect(formatLashZone(z[3]!)).toBe("11mm C .07 6D W Dark brown");
    expect(formatLashType("YY")).toBe("YY");
    expect(formatLashType("Spike")).toBe("Spike fans");
  });
  it("keeps flat as a shape on any type, and reads the old Flat type as a flat classic", () => {
    const zs = starterLashZones(6).map((x, i) => ({ ...x, thickness: 0.15, flat: i < 3, type: i === 1 ? "Hybrid" : i === 2 ? "Flat" : "Classic", spike: i === 0 ? { length: 12, flat: true } : null }));
    const z = parseLashZones(zs);
    expect(z.map((x) => [x.type, x.flat])).toEqual([["Classic", true], ["Hybrid", true], ["Classic", true], ["Classic", false], ["Classic", false], ["Classic", false]]);
    expect(z[0]?.spike?.flat).toBe(true);
    expect(formatLashZone(z[1]!)).toBe("9mm C .15 flat Hybrid");
    expect(allLashFlat(z)).toBe(false);
    expect(allLashFlat(z.map((x) => ({ ...x, flat: true })))).toBe(true);
    const old = normalizeLashZones([{ length: 10, curl: "C", thickness: 0.15, type: "Flat", spike: { length: 12, curl: "C", thickness: 0.15, type: "Flat" } }]);
    expect(old[0]).toMatchObject({ type: "Classic", flat: true, spike: { type: "Classic", flat: true } });
  });
  it("records which fan a hybrid mixes with classics, and keeps a bare Hybrid valid", () => {
    const zs = starterLashZones(6).map((x, i) => ({ ...x, type: ["Hybrid 3D", "Hybrid YY", "Hybrid 4D W", "Hybrid", "Classic", "5D"][i] }));
    expect(parseLashZones(zs).map((x) => x.type)).toEqual(["Hybrid 3D", "Hybrid YY", "Hybrid 4D W", "Hybrid", "Classic", "5D"]);
    expect(() => parseLashZones(zs.map((x, i) => (i === 0 ? { ...x, type: "Hybrid Spike" } : x)))).toThrow(/Zone 1: type/);
    expect(formatLashType("Hybrid 3D")).toBe("Hybrid (classic + 3D)");
    expect(formatLashType("Hybrid")).toBe("Hybrid");
    expect([lashHybridFan("Hybrid 4D W"), lashHybridFan("Hybrid"), lashHybridFan("3D"), lashHybridFan(null)]).toEqual(["4D W", "", null, null]);
  });
  it("rejects colours that aren't a short name", () => {
    const zs = starterLashZones(6).map((x, i) => (i === 4 ? { ...x, color: "#ff0000" } : x));
    expect(() => parseLashZones(zs)).toThrow(/Zone 5: colour/);
    const spike = starterLashZones(6).map((x, i) => (i === 1 ? { ...x, spike: { length: 12, color: "a very long colour name here" } } : x));
    expect(() => parseLashZones(spike)).toThrow(/Spike between zones 2 and 3: colour/);
  });
  it("summarises where colours are used", () => {
    const zs = starterLashZones(7);
    expect(lashColorSummary(zs)).toBeNull();
    expect(lashColorSummary(zs.map((x) => ({ ...x, color: "Brown" })))).toBe("Brown throughout");
    const accents = zs.map((x, i) => ({ ...x, color: i >= 5 ? "Blue" : null, spike: i === 4 ? { length: 14, curl: "C", thickness: 0.07, color: "Purple" } : null }));
    expect(lashColorSummary(accents)).toBe("Purple: spike 5–6 · Blue: zones 6, 7");
  });
});

describe("length styles", () => {
  it("fills lengths from the longest, shaped by style, within the allowed range", () => {
    expect(lashLengthStyle("Cat eye", 6, 12)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(lashLengthStyle("Doll eye", 7, 12)).toEqual([9, 10, 11, 12, 11, 10, 9]);
    expect(lashLengthStyle("Squirrel", 7, 13)).toEqual([9, 10, 11, 12, 13, 12, 10]);
    expect(lashLengthStyle("Cat eye", 6, 7)[0]).toBe(4);
    expect(lashLengthStyle("Natural", 6, 20)).toHaveLength(6);
    expect(LASH_LENGTH_STYLES).toContain("Open eye");
  });
});

describe("separate eyes", () => {
  it("names the eye in every message when the eyes are mapped separately", () => {
    const bad = starterLashZones(6).map((x, i) => (i === 1 ? { ...x, length: 30 } : i === 2 ? { ...x, spike: { length: null } } : x));
    expect(() => parseLashZones(bad.map((x, i) => (i === 2 ? { ...x, spike: null } : x)), "Right eye")).toThrow(/^Right eye, zone 2: length/);
    expect(() => parseLashZones(bad.map((x, i) => (i === 1 ? { ...x, length: 9 } : x)), "Left eye")).toThrow(/^Left eye, spike between zones 3 and 4/);
    expect(() => parseLashZones([], "Right eye")).toThrow(/^Right eye: a lash map has 6 or 7 zones/);
  });
});

describe("formatting", () => {
  it("writes thickness the way lash trays do", () => {
    expect(formatLashThickness(0.07)).toBe(".07");
    expect(formatLashThickness(0.1)).toBe(".10");
    expect(formatLashThickness(0.035)).toBe(".035");
    expect(formatLashZone({ length: 11, curl: "CC", thickness: 0.05 })).toBe("11mm CC .05");
    expect(formatLashZone({ length: 11, curl: "CC", thickness: 0.05, type: "4D" })).toBe("11mm CC .05 4D");
    expect(formatLashZone({ length: null, curl: null, thickness: null })).toBe("—");
  });
});
