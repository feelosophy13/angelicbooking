import { describe, expect, it } from "vitest";
import { MAX_TAGS, pairKey, parseGalleryFilters, parseTags } from "../visit-photos";

describe("parseTags", () => {
  it("lower-cases, drops hashes and duplicates, and ignores blanks", () => {
    expect(parseTags("Balayage, #Blonde ,  BALAYAGE,, ")).toEqual(["balayage", "blonde"]);
  });
  it("accepts semicolons and new lines too", () => {
    expect(parseTags("a;b\nc")).toEqual(["a", "b", "c"]);
  });
  it("caps how many tags and how long each is", () => {
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(","))).toHaveLength(MAX_TAGS);
    expect(parseTags("x".repeat(80))[0]).toHaveLength(30);
  });
  it("copes with nothing", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("pairKey", () => {
  it("groups by appointment, service and stylist", () => {
    expect(pairKey({ appointmentId: "a", serviceId: "s", staffId: "t" })).toBe("a:s:t");
    expect(pairKey({ appointmentId: "a", serviceId: null, staffId: null })).toBe("a::");
  });
});

describe("parseGalleryFilters", () => {
  const valid = { serviceIds: ["s1"], staffIds: ["t1"], locationIds: ["l1"] };
  it("keeps known ids and drops unknown ones", () => {
    const f = parseGalleryFilters({ service: "s1", staff: "nope", location: "l1" }, valid);
    expect(f).toMatchObject({ serviceId: "s1", staffId: null, locationId: "l1" });
  });
  it("reads the period, switches and page", () => {
    const f = parseGalleryFilters({ period: "90", both: "1", share: "1", page: "3", tag: "#Blonde" }, valid);
    expect(f).toMatchObject({ periodDays: 90, bothOnly: true, shareableOnly: true, page: 3, tag: "blonde" });
  });
  it("reads a whole category from a c:<id> choice, and a service otherwise", () => {
    const v = { ...valid, categoryIds: ["c1"] };
    expect(parseGalleryFilters({ service: "c:c1" }, v)).toMatchObject({ categoryId: "c1", serviceId: null });
    expect(parseGalleryFilters({ service: "s1" }, v)).toMatchObject({ categoryId: null, serviceId: "s1" });
    expect(parseGalleryFilters({ service: "c:nope" }, v)).toMatchObject({ categoryId: null, serviceId: null });
  });
  it("falls back safely on junk", () => {
    const f = parseGalleryFilters({ period: "7", page: "-4", client: "x y" }, valid);
    expect(f).toMatchObject({ periodDays: null, page: 1, clientId: null });
  });
});

import { buildPairs, type PhotoQueryRow } from "../visit-photos";

const row = (over: Partial<PhotoQueryRow>): PhotoQueryRow => ({ id: "p", phase: "before", fileId: "f", thumbFileId: "t", takenAt: new Date("2026-10-01T10:00:00Z"), appointmentId: "a1", clientId: "c1", serviceId: "s1", staffId: "t1", tags: [], shareOk: false, serviceName: "Balayage", staffName: "Ava", firstName: "Jo", lastName: "Lee", locationId: null, ...over });

describe("buildPairs", () => {
  it("puts before and after of the same appointment, service and stylist together", () => {
    const pairs = buildPairs([row({ id: "1" }), row({ id: "2", phase: "after" }), row({ id: "3", serviceId: "s2", serviceName: "Cut" })]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.before.map((p) => p.id)).toEqual(["1"]);
    expect(pairs[0]!.after.map((p) => p.id)).toEqual(["2"]);
    expect(pairs[0]!.clientName).toBe("Jo Lee");
  });
  it("returns only the requested pairs, in the requested order", () => {
    const rows = [row({ id: "1", appointmentId: "a1" }), row({ id: "2", appointmentId: "a2" })];
    expect(buildPairs(rows, ["a2:s1:t1", "a1:s1:t1", "zzz"]).map((p) => p.appointmentId)).toEqual(["a2", "a1"]);
  });
  it("keeps the earliest photo time and tolerates a missing client", () => {
    const pairs = buildPairs([row({ id: "1", takenAt: new Date("2026-10-02T00:00:00Z"), firstName: null, lastName: null }), row({ id: "2", phase: "after", takenAt: new Date("2026-10-01T00:00:00Z") })]);
    expect(pairs[0]!.takenAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(pairs[0]!.clientName).toBeNull();
  });
});
