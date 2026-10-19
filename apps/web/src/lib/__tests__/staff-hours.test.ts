import { describe, expect, it } from "vitest";
import { orderStaff } from "../staff-hours";

const s = (name: string, takesAppointments: boolean, sortOrder: number, position: string | null = null) => ({ id: name, name, takesAppointments, sortOrder, position });

describe("orderStaff", () => {
  it("puts providers first in booking order, then other staff", () => {
    const people = [s("Dana", false, 5, "Front Desk"), s("Mina", true, 4), s("Owner", false, 0, "Owner"), s("Ava", true, 0), s("Jordan", true, 1)];
    expect(orderStaff(people).map((p) => p.name)).toEqual(["Ava", "Jordan", "Mina", "Owner", "Dana"]);
  });
});
