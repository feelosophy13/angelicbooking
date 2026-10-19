import { describe, expect, it } from "vitest";
import { hoursShort, matchesPeople, monthDates, monthLabel, monthLeadingBlanks, monthOf, orderStaff, parsePeopleFilter, peopleOptions, shiftMonth } from "../staff-hours";

const s = (name: string, takesAppointments: boolean, sortOrder: number, role: string | null = null) => ({ id: name, name, takesAppointments, sortOrder, role });
const ROLES = [{ key: "owner", name: "Owner" }, { key: "manager", name: "Manager" }, { key: "provider", name: "Provider" }, { key: "front_desk", name: "Front desk" }, { key: "senior_stylist", name: "Senior stylist" }];

describe("orderStaff", () => {
  it("puts providers first in booking order, then other staff", () => {
    const people = [s("Dana", false, 5, "front_desk"), s("Mina", true, 4), s("Owner", false, 0, "owner"), s("Ava", true, 0), s("Jordan", true, 1)];
    expect(orderStaff(people).map((p) => p.name)).toEqual(["Ava", "Jordan", "Mina", "Owner", "Dana"]);
  });
});

describe("peopleOptions", () => {
  it("offers Everyone, the roles somebody holds in the business's order, then No login yet", () => {
    const people = [s("Ava", true, 0, "manager"), s("Jordan", true, 1, "provider"), s("Dana", false, 5, "front_desk"), s("Owner", false, 0, "owner"), s("Sofia", true, 3, null)];
    expect(peopleOptions(people, ROLES)).toEqual([
      { value: "", label: "Everyone" },
      { value: "r:owner", label: "Owner" },
      { value: "r:manager", label: "Manager" },
      { value: "r:provider", label: "Provider" },
      { value: "r:front_desk", label: "Front desk" },
      { value: "nologin", label: "No login yet" },
    ]);
  });
  it("leaves out roles nobody holds and No login yet when everyone has one", () => {
    expect(peopleOptions([s("Owner", false, 0, "owner")], ROLES)).toEqual([{ value: "", label: "Everyone" }, { value: "r:owner", label: "Owner" }]);
  });
});

describe("parsePeopleFilter / matchesPeople", () => {
  const people = [s("Ava", true, 0, "provider"), s("Dana", false, 5, "front_desk"), s("Owner", false, 0, "owner"), s("Temp", true, 9, null)];
  it("accepts held roles and nologin, falls back to everyone", () => {
    expect(parsePeopleFilter("r:provider", people, ROLES)).toBe("r:provider");
    expect(parsePeopleFilter("nologin", people, ROLES)).toBe("nologin");
    expect(parsePeopleFilter("r:manager", people, ROLES)).toBe("");
    expect(parsePeopleFilter("r:ceo", people, ROLES)).toBe("");
    expect(parsePeopleFilter(undefined, people, ROLES)).toBe("");
    expect(parsePeopleFilter("x", people, ROLES)).toBe("");
  });
  it("filters by login role or by having none", () => {
    const names = (f: Parameters<typeof matchesPeople>[1]) => people.filter((p) => matchesPeople(p, f)).map((p) => p.name);
    expect(names("")).toEqual(["Ava", "Dana", "Owner", "Temp"]);
    expect(names("r:provider")).toEqual(["Ava"]);
    expect(names("r:front_desk")).toEqual(["Dana"]);
    expect(names("nologin")).toEqual(["Temp"]);
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
