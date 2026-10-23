import { describe, expect, it } from "vitest";
import { checkinDigits, checkinTiming, kioskName, pickVisit } from "@/lib/checkin";

describe("check-in kiosk rules", () => {
  it("takes the last four digits or a full number, nothing in between", () => {
    expect(checkinDigits("4567")).toEqual({ digits: "4567", full: false });
    expect(checkinDigits("(555) 123-4567")).toEqual({ digits: "5551234567", full: true });
    expect(checkinDigits("1 555 123 4567")).toEqual({ digits: "5551234567", full: true });
    expect(checkinDigits("567")).toBeNull();
    expect(checkinDigits("1234567")).toBeNull();
    expect(checkinDigits("25551234567")).toBeNull();
  });

  it("names a client by first name and last initial only", () => {
    expect(kioskName("Jane", "Smith")).toBe("Jane S.");
    expect(kioskName("Jane", "")).toBe("Jane");
    expect(kioskName("  ", null)).toBe("Guest");
    expect(kioskName("ana", "de la cruz")).toBe("ana D.");
  });

  it("opens check-in from the early window until the visit ends", () => {
    const start = new Date("2026-10-22T15:00:00Z");
    const end = new Date("2026-10-22T16:00:00Z");
    const at = (iso: string) => checkinTiming(start, end, new Date(iso), 30);
    expect(at("2026-10-22T14:29:00Z")).toBe("early");
    expect(at("2026-10-22T14:30:00Z")).toBe("ready");
    expect(at("2026-10-22T15:40:00Z")).toBe("ready");
    expect(at("2026-10-22T16:00:01Z")).toBe("late");
    expect(checkinTiming(start, end, new Date("2026-10-22T15:00:00Z"), 0)).toBe("ready");
    expect(checkinTiming(start, end, new Date("2026-10-22T14:59:00Z"), 0)).toBe("early");
  });

  it("picks the visit the client is arriving for", () => {
    const v = (h: number) => ({ id: h, startAt: new Date(Date.UTC(2026, 9, 22, h)), endAt: new Date(Date.UTC(2026, 9, 22, h + 1)) });
    const now = new Date(Date.UTC(2026, 9, 22, 12, 30));
    expect(pickVisit([v(15), v(9), v(12)], now)?.id).toBe(12);
    expect(pickVisit([v(9), v(10)], now)?.id).toBe(10);
    expect(pickVisit([], now)).toBeNull();
  });
});
