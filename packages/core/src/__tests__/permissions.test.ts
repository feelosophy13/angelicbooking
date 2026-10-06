import { describe, expect, it } from "vitest";
import { can, canActOnAppointment } from "../permissions";

describe("permissions", () => {
  it("owner can do everything, manager everything but business settings", () => {
    expect(can("owner", "business.manage")).toBe(true);
    expect(can("manager", "business.manage")).toBe(false);
    expect(can("manager", "payroll.view")).toBe(true);
  });
  it("providers only touch their own calendar", () => {
    expect(canActOnAppointment("provider", "write", "u1", "u1")).toBe(true);
    expect(canActOnAppointment("provider", "write", "u1", "u2")).toBe(false);
    expect(canActOnAppointment("front_desk", "write", "u1", "u2")).toBe(true);
    expect(can("provider", "reports.view")).toBe(false);
  });
  it("rejects unknown roles", () => {
    expect(can("admin", "clients.read")).toBe(false);
    expect(can(null, "clients.read")).toBe(false);
  });
});
