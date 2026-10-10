import { describe, expect, it } from "vitest";
import { clampToOpenHours } from "../availability";

describe("clampToOpenHours", () => {
  const blocks = [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "20:00" }];
  it("leaves blocks alone when the location has no hours", () => {
    expect(clampToOpenHours(blocks, undefined)).toEqual(blocks);
  });
  it("removes everything on a closed day", () => {
    expect(clampToOpenHours(blocks, null)).toEqual([]);
  });
  it("trims to the open window and drops blocks outside it", () => {
    expect(clampToOpenHours(blocks, { open: "10:00", close: "18:00" })).toEqual([{ start: "10:00", end: "12:00" }, { start: "13:00", end: "18:00" }]);
    expect(clampToOpenHours([{ start: "06:00", end: "09:00" }], { open: "10:00", close: "18:00" })).toEqual([]);
  });
});
