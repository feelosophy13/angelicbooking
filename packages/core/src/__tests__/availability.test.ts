import { describe, expect, it } from "vitest";
import { buildBookingSegments, computeAvailableSlots, resolveWorkingBlocks } from "../availability";
import { zonedToInstant, instantToISODate, weekdayOf } from "../time";

const NY = "America/New_York";
const at = (t: string, d = "2026-10-06") => zonedToInstant(d, t, NY);
const local = (dates: Date[]) =>
  dates.map((d) => new Intl.DateTimeFormat("en-GB", { timeZone: NY, hour: "2-digit", minute: "2-digit" }).format(d));

describe("time", () => {
  it("converts wall clock to instants with DST awareness", () => {
    // EDT (UTC-4) in October
    expect(at("09:00").toISOString()).toBe("2026-10-06T13:00:00.000Z");
    // EST (UTC-5) in January
    expect(zonedToInstant("2026-01-06", "09:00", NY).toISOString()).toBe("2026-01-06T14:00:00.000Z");
    // Spring-forward day: 09:00 local is already EDT
    expect(zonedToInstant("2026-03-08", "09:00", NY).toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  it("maps instants back to local calendar dates", () => {
    expect(instantToISODate(new Date("2026-10-07T02:30:00Z"), NY)).toBe("2026-10-06");
    expect(weekdayOf("2026-10-06")).toBe(2); // Tuesday
  });
});

describe("buildBookingSegments", () => {
  it("is a single block for simple services", () => {
    const s = buildBookingSegments(at("10:00"), { durationMin: 45, bufferAfterMin: 15 });
    expect(local(s.flatMap((x) => [x.start, x.end]))).toEqual(["10:00", "11:00"]);
  });
  it("leaves the processing gap free", () => {
    const s = buildBookingSegments(at("10:00"), { durationMin: 30, gapMin: 30, finishMin: 15 });
    expect(s.map((x) => x.kind)).toEqual(["active", "finish"]);
    expect(local(s.flatMap((x) => [x.start, x.end]))).toEqual(["10:00", "10:30", "11:00", "11:15"]);
  });
});

describe("resolveWorkingBlocks", () => {
  const weekly = [
    { weekday: 2, start: "09:00", end: "12:00" },
    { weekday: 2, start: "13:00", end: "17:00" },
    { weekday: 3, start: "10:00", end: "18:00" },
  ];
  it("uses the weekly template", () => {
    expect(resolveWorkingBlocks("2026-10-06", 2, weekly)).toHaveLength(2);
  });
  it("honours a day off", () => {
    expect(resolveWorkingBlocks("2026-10-06", 2, weekly, { date: "2026-10-06", isOff: true })).toEqual([]);
  });
  it("honours custom hours", () => {
    expect(
      resolveWorkingBlocks("2026-10-06", 2, weekly, { date: "2026-10-06", isOff: false, start: "11:00", end: "15:00" }),
    ).toEqual([{ start: "11:00", end: "15:00" }]);
  });
});

describe("computeAvailableSlots", () => {
  const base = {
    date: "2026-10-06",
    timeZone: NY,
    workingBlocks: [{ start: "09:00", end: "12:00" }],
    slotIntervalMin: 30,
  };

  it("returns every slot that fits inside working hours", () => {
    const slots = computeAvailableSlots({ ...base, busy: [], service: { durationMin: 60 } });
    expect(local(slots)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("excludes slots that collide with existing bookings", () => {
    const slots = computeAvailableSlots({
      ...base,
      busy: [{ start: at("10:00"), end: at("10:45") }],
      service: { durationMin: 30 },
    });
    expect(local(slots)).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("allows a booking whose processing gap overlaps another client", () => {
    const slots = computeAvailableSlots({
      ...base,
      busy: [{ start: at("09:30"), end: at("10:00") }], // someone else's quick service
      service: { durationMin: 30, gapMin: 30, finishMin: 15 },
    });
    // 09:00 works: active 09:00-09:30, gap 09:30-10:00 (busy, fine), finish 10:00-10:15
    expect(local(slots)).toContain("09:00");
    // 09:30 collides on the active block
    expect(local(slots)).not.toContain("09:30");
  });

  it("respects a not-before cutoff and returns nothing when off", () => {
    const slots = computeAvailableSlots({
      ...base,
      busy: [],
      service: { durationMin: 60 },
      notBefore: at("10:15"),
    });
    expect(local(slots)).toEqual(["10:30", "11:00"]);
    expect(computeAvailableSlots({ ...base, workingBlocks: [], busy: [], service: { durationMin: 30 } })).toEqual([]);
  });

  it("does not straddle a lunch break", () => {
    const slots = computeAvailableSlots({
      ...base,
      workingBlocks: [
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "15:00" },
      ],
      busy: [],
      service: { durationMin: 90 },
    });
    expect(local(slots)).toEqual(["09:00", "09:30", "10:00", "10:30", "13:00", "13:30"]);
  });
});
