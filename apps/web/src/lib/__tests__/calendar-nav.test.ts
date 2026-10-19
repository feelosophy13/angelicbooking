import { describe, expect, it } from "vitest";
import { miniMonthCells, monthLabel, monthStartOf, shiftMonth, shortcutFor, startOfWeek, weekdayLabels } from "../calendar-nav";

describe("mini month", () => {
  it("lays the month out Monday-first in whole weeks, padding with the neighbouring months", () => {
    // October 2026 starts on a Thursday and has 31 days: 3 lead days, 5 rows.
    const cells = miniMonthCells("2026-10-01");
    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 4).map((c) => c.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(cells.filter((c) => !c.outside)).toHaveLength(31);
    expect(cells[cells.length - 1]).toEqual({ date: "2026-11-01", day: 1, outside: true });
  });
  it("needs six rows when a long month starts late in the week", () => {
    // August 2026 starts on a Saturday.
    expect(miniMonthCells("2026-08-01")).toHaveLength(42);
  });
  it("follows the business's first day of the week", () => {
    // Sunday-first: October 2026 starts on a Thursday, so 4 lead days (Sun 27 Sep … Wed 30 Sep).
    const cells = miniMonthCells("2026-10-01", 0);
    expect(cells[0]!.date).toBe("2026-09-27");
    expect(weekdayLabels(0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayLabels(1)[0]).toBe("Mon");
    expect(startOfWeek("2026-10-18", 1)).toBe("2026-10-12"); // a Sunday belongs to the Monday-first week before it
    expect(startOfWeek("2026-10-18", 0)).toBe("2026-10-18");
    expect(startOfWeek("2026-10-20", 6)).toBe("2026-10-17");
  });
  it("steps months across a year end and names them", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthStartOf("2026-10-18")).toBe("2026-10-01");
    expect(monthLabel("2026-10-01")).toBe("October 2026");
  });
});

describe("keyboard shortcuts", () => {
  it("maps Google Calendar's keys", () => {
    expect(shortcutFor({ key: "t", inField: false })).toBe("today");
    expect(shortcutFor({ key: "ArrowLeft", inField: false })).toBe("prev");
    expect(shortcutFor({ key: "k", inField: false })).toBe("next");
    expect(shortcutFor({ key: "w", inField: false })).toBe("week");
    expect(shortcutFor({ key: "c", inField: false })).toBe("create");
    expect(shortcutFor({ key: "/", inField: false })).toBe("search");
    expect(shortcutFor({ key: "?", inField: false })).toBe("help");
    expect(shortcutFor({ key: "x", inField: false })).toBeNull();
  });
  it("stays out of the way while typing or with a modifier held", () => {
    expect(shortcutFor({ key: "t", inField: true })).toBeNull();
    expect(shortcutFor({ key: "k", metaKey: true, inField: false })).toBeNull();
    expect(shortcutFor({ key: "ArrowLeft", altKey: true, inField: false })).toBeNull();
  });
});
