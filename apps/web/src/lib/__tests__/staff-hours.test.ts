import { describe, expect, it } from "vitest";
import { matchesPeople, orderStaff, parsePeopleFilter, peopleOptions } from "../staff-hours";

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
