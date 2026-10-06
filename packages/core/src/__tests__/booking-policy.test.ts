import { describe, expect, it } from "vitest";
import { canClientCancel, isWithinBookingWindow, normalizePhone } from "../booking-policy";

const now = new Date("2026-10-06T12:00:00Z");
const policy = { minNoticeMin: 120, maxAdvanceDays: 30, cancelWindowHours: 24 };

describe("booking window", () => {
  it("rejects too-soon and too-far starts", () => {
    expect(isWithinBookingWindow(new Date("2026-10-06T13:00:00Z"), now, policy)).toBe(false);
    expect(isWithinBookingWindow(new Date("2026-10-06T14:00:00Z"), now, policy)).toBe(true);
    expect(isWithinBookingWindow(new Date("2026-11-05T11:00:00Z"), now, policy)).toBe(true);
    expect(isWithinBookingWindow(new Date("2026-11-06T12:00:01Z"), now, policy)).toBe(false);
  });
});

describe("client cancellation", () => {
  it("allows until the window closes", () => {
    expect(canClientCancel(new Date("2026-10-07T12:00:00Z"), now, policy)).toBe(true);
    expect(canClientCancel(new Date("2026-10-07T11:59:00Z"), now, policy)).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("formats US numbers to E.164", () => {
    expect(normalizePhone("(555) 010-0123")).toBe("+15550100123");
    expect(normalizePhone("1 555 010 0123")).toBe("+15550100123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
