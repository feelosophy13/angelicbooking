import { describe, expect, it } from "vitest";
import { hoursShort, matchesPeople, monthDates, monthLabel, monthLeadingBlanks, monthOf, orderStaff, parsePeopleFilter, peopleOptions, shiftMonth } from "../staff-hours";

const s = (name: string, takesAppointments: boolean, sortOrder: number, position: string | null = null) => ({ id: name, name, takesAppointments, sortOrder, position });

describe("orderStaff", () => {
  it("puts providers first in booking order, then other staff", () => {
    const people = [s("Dana", false, 5, "Front Desk"), s("Mina", true, 4), s("Owner", false, 0, "Owner"), s("Ava", true, 0), s("Jordan", true, 1)];
    expect(orderStaff(people).map((p) => p.name)).toEqual(["Ava", "Jordan", "Mina", "Owner", "Dana"]);
  });
});

describe("peopleOptions", () => {
  it("lists the fixed choices, then each position once, title-cased", () => {
    const people = [s("Ava", true, 0, "lash artist"), s("Jordan", true, 1, "Lash Artist"), s("Dana", false, 5, "front desk"), s("Mina", true, 4, "Color Consultant & PMU Artist"), s("Owner", false, 0, null), s("Sofia", true, 3, "  brow & wax   specialist ")];
    expect(peopleOptions(people)).toEqual([
      { value: "", label: "Everyone" },
      { value: "providers", label: "Providers" },
      { value: "other", label: "Front desk & other staff" },
      { value: "p:brow & wax specialist", label: "Brow & Wax Specialist" },
      { value: "p:color consultant & pmu artist", label: "Color Consultant & Pmu Artist" },
      { value: "p:front desk", label: "Front Desk" },
      { value: "p:lash artist", label: "Lash Artist" },
    ]);
  });
});

describe("parsePeopleFilter / matchesPeople", () => {
  const people = [s("Ava", true, 0, "Lash Artist"), s("Dana", false, 5, "Front Desk"), s("Owner", false, 0, null)];
  it("accepts the fixed values and known positions, falls back to everyone", () => {
    expect(parsePeopleFilter("providers", people)).toBe("providers");
    expect(parsePeopleFilter("other", people)).toBe("other");
    expect(parsePeopleFilter("p:front desk", people)).toBe("p:front desk");
    expect(parsePeopleFilter("p:ceo", people)).toBe("");
    expect(parsePeopleFilter(undefined, people)).toBe("");
    expect(parsePeopleFilter("x", people)).toBe("");
  });
  it("filters by provider flag or by position, ignoring case", () => {
    const names = (f: Parameters<typeof matchesPeople>[1]) => people.filter((p) => matchesPeople(p, f)).map((p) => p.name);
    expect(names("")).toEqual(["Ava", "Dana", "Owner"]);
    expect(names("providers")).toEqual(["Ava"]);
    expect(names("other")).toEqual(["Dana", "Owner"]);
    expect(names("p:front desk")).toEqual(["Dana"]);
    expect(matchesPeople(s("X", true, 0, "FRONT  DESK"), "p:front desk")).toBe(true);
  });
});

describe("month helpers", () => {
  it("moves months across year ends and lists the right days", () => {
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthDates("2026-02")).toHaveLength(28);
    expect(monthDates("2028-02")).toHaveLength(29);
    expect(monthDates("2026-10")[0]).toBe("2026-10-01");
    expect(monthDates("2026-10").at(-1)).toBe("2026-10-31");
    expect(monthOf("2026-10-18")).toBe("2026-10");
  });
  it("starts the grid on Monday", () => {
    expect(monthLeadingBlanks("2026-10")).toBe(3); // 1 Oct 2026 is a Thursday
    expect(monthLeadingBlanks("2026-06")).toBe(0); // 1 Jun 2026 is a Monday
    expect(monthLeadingBlanks("2026-11")).toBe(6); // 1 Nov 2026 is a Sunday
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
  it("writes hours the short way", () => {
    expect(hoursShort([{ start: 540, end: 1020 }])).toBe("9–5");
    expect(hoursShort([{ start: 570, end: 1050 }])).toBe("9:30–5:30");
    expect(hoursShort([{ start: 720, end: 1200 }])).toBe("12–8");
    expect(hoursShort([{ start: 0, end: 1440 }])).toBe("12–12");
    expect(hoursShort([{ start: 540, end: 720 }, { start: 780, end: 1020 }])).toBe("9–12, 1–5");
  });
});
