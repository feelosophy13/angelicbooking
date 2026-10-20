import { describe, expect, it } from "vitest";
import { phone } from "../format";

describe("phone", () => {
  it("reads US and Canada numbers the usual way, stored or typed", () => {
    expect(phone("+17035551024")).toBe("(703) 555-1024");
    expect(phone("7035551024")).toBe("(703) 555-1024");
    expect(phone("1-703-555-1024")).toBe("(703) 555-1024");
  });

  it("leaves anything else as it was", () => {
    expect(phone("+442071838750")).toBe("+442071838750");
    expect(phone("555-1024")).toBe("555-1024");
    expect(phone("3 of 8 seats taken")).toBe("3 of 8 seats taken");
  });
});
