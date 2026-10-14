import { describe, expect, it } from "vitest";
import { buildBookingSegments } from "@angelic/core";
import { describeTiming, wholeMinutes } from "../service-timing";

describe("describing a service's times", () => {
  it("a simple service is booked solid", () => {
    expect(describeTiming({ duration: 60, gap: 0, finish: 0, buffer: 0 })).toEqual({ tone: "ok", text: "Booked solid for 1 h." });
    expect(describeTiming({ duration: 45, gap: 0, finish: 0, buffer: 15 }).text).toBe("Booked solid for 1 h, including 15 min of clean-up.");
  });
  it("a wait with a finish frees the stylist in the middle", () => {
    const d = describeTiming({ duration: 30, gap: 45, finish: 20, buffer: 10 });
    expect(d.tone).toBe("ok");
    expect(d.text).toContain("free for 45 min");
    expect(d.text).toContain("1 h 45 min in all");
  });
  it("a wait with no finish does not free the stylist, and says so", () => {
    const d = describeTiming({ duration: 30, gap: 45, finish: 0, buffer: 0 });
    expect(d.tone).toBe("warn");
    expect(d.text).toContain("will NOT free you up");
  });
  it("matches what the calendar really blocks", () => {
    const start = new Date("2026-10-14T10:00:00Z");
    const freeing = buildBookingSegments(start, { durationMin: 30, gapMin: 45, finishMin: 20, bufferAfterMin: 10 });
    expect(freeing).toHaveLength(2); // two busy blocks, the wait is open
    const notFreeing = buildBookingSegments(start, { durationMin: 30, gapMin: 45 });
    expect(notFreeing).toHaveLength(1); // one block: the wait is not open
  });
  it("reads blanks and negatives as zero", () => {
    expect(wholeMinutes("")).toBe(0);
    expect(wholeMinutes("-5")).toBe(0);
    expect(wholeMinutes("12.4")).toBe(12);
  });
});
