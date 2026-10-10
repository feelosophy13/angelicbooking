import { describe, expect, it } from "vitest";
import { addWeeksSameLocalTime, instantToLocalTime, seriesOccurrences, zonedToInstant } from "../time";

const NY = "America/New_York";

describe("standing appointment occurrences", () => {
  it("keeps the wall-clock time across a DST change", () => {
    const first = zonedToInstant("2026-10-20", "10:00", NY); // EDT
    const later = addWeeksSameLocalTime(first, 4, NY); // 2026-11-17, EST
    expect(instantToLocalTime(later, NY)).toBe("10:00");
    expect(later.getTime() - first.getTime()).toBe(28 * 24 * 3_600_000 + 3_600_000);
  });

  it("generates n occurrences every k weeks, capped at 52", () => {
    const first = zonedToInstant("2026-01-05", "09:30", NY);
    const dates = seriesOccurrences(first, 2, 4, NY);
    expect(dates).toHaveLength(4);
    expect(dates[0]).toEqual(first);
    expect(instantToLocalTime(dates[3]!, NY)).toBe("09:30");
    expect(dates[3]!.getTime() - first.getTime()).toBe(6 * 7 * 24 * 3_600_000);
    expect(seriesOccurrences(first, 1, 500, NY)).toHaveLength(52);
  });
});
