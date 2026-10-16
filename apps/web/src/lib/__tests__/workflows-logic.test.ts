import { describe, expect, it } from "vitest";
import { deferToDaytime, matchesFilters, summarizeSteps, validateSteps, waitResumesAt, birthdayKeys, noVisitWindow } from "../workflows-logic";

describe("matchesFilters", () => {
  it("can be limited to bookings the client made online", () => {
    expect(matchesFilters({ onlineOnly: true }, { source: "online" })).toBe(true);
    expect(matchesFilters({ onlineOnly: true }, { source: "staff" })).toBe(false);
    expect(matchesFilters({ onlineOnly: true }, {})).toBe(false);
    expect(matchesFilters({ onlineOnly: false }, { source: "staff" })).toBe(true);
  });
  it("matches everything when nothing is set", () => {
    expect(matchesFilters({}, {})).toBe(true);
    expect(matchesFilters(null, { rating: 1 })).toBe(true);
  });
  it("requires any overlap on list filters", () => {
    expect(matchesFilters({ serviceIds: ["a", "b"] }, { serviceIds: ["b", "z"] })).toBe(true);
    expect(matchesFilters({ serviceIds: ["a"] }, { serviceIds: ["z"] })).toBe(false);
    expect(matchesFilters({ categoryIds: ["hair"] }, { categoryIds: ["colour", "hair"] })).toBe(true);
    expect(matchesFilters({ tags: ["VIP"] }, { clientTags: [] })).toBe(false);
  });
  it("checks location, provider, rating range and first visit", () => {
    expect(matchesFilters({ locationIds: ["l1"] }, { locationId: "l2" })).toBe(false);
    expect(matchesFilters({ staffIds: ["s1"] }, { staffId: "s1" })).toBe(true);
    expect(matchesFilters({ maxRating: 3 }, { rating: 4 })).toBe(false);
    expect(matchesFilters({ maxRating: 3 }, { rating: 3 })).toBe(true);
    expect(matchesFilters({ minRating: 4 }, { rating: null })).toBe(false);
    expect(matchesFilters({ firstVisitOnly: true }, { firstVisit: false })).toBe(false);
    expect(matchesFilters({ firstVisitOnly: true }, { firstVisit: true })).toBe(true);
  });
});

describe("timing", () => {
  const tz = "America/New_York";
  it("leaves daytime sends alone and defers night sends to 9am", () => {
    const noon = new Date("2026-07-14T16:00:00Z"); // 12:00 EDT
    expect(deferToDaytime(noon, tz).getTime()).toBe(noon.getTime());
    const late = new Date("2026-07-15T02:30:00Z"); // 22:30 EDT on the 14th
    expect(deferToDaytime(late, tz).toISOString()).toBe("2026-07-15T13:00:00.000Z"); // 9:00 EDT on the 15th
    const early = new Date("2026-07-15T10:15:00Z"); // 06:15 EDT
    expect(deferToDaytime(early, tz).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });
  it("computes relative waits from the appointment", () => {
    const appt = { startAt: new Date("2026-07-20T14:00:00Z"), endAt: new Date("2026-07-20T15:00:00Z") };
    const now = new Date("2026-07-10T00:00:00Z");
    expect(waitResumesAt({ id: "w", type: "wait", mode: "before_appointment", hours: 24 }, now, appt)?.toISOString()).toBe("2026-07-19T14:00:00.000Z");
    expect(waitResumesAt({ id: "w", type: "wait", mode: "after_appointment", hours: 2 }, now, appt)?.toISOString()).toBe("2026-07-20T17:00:00.000Z");
    expect(waitResumesAt({ id: "w", type: "wait", mode: "delay", hours: 1 }, now)?.toISOString()).toBe("2026-07-10T01:00:00.000Z");
    expect(waitResumesAt({ id: "w", type: "wait", mode: "before_appointment", hours: 1 }, now, null)).toBeNull();
  });
});

describe("steps", () => {
  it("validates per trigger", () => {
    expect(validateSteps([], "birthday")).toEqual(["Add at least one step."]);
    expect(validateSteps([{ id: "1", type: "wait", mode: "before_appointment", hours: 2 }, { id: "2", type: "sms", body: "hi" }], "birthday")[0]).toMatch(/needs an appointment trigger/);
    expect(validateSteps([{ id: "1", type: "review_request" }], "appointment_booked")[0]).toMatch(/Visit completed/);
    expect(validateSteps([{ id: "1", type: "wait", mode: "after_appointment", hours: 2 }, { id: "2", type: "review_request" }], "appointment_completed")).toEqual([]);
  });
  it("summarises", () => {
    expect(summarizeSteps([{ id: "1", type: "wait", mode: "before_appointment", hours: 48 }, { id: "2", type: "sms", body: "x" }, { id: "3", type: "email", subject: "s", body: "b" }])).toBe("2 days before the visit → text + email");
    expect(summarizeSteps([{ id: "1", type: "wait", mode: "delay", hours: 1 }, { id: "2", type: "notify_staff", to: "owner", body: "x" }])).toBe("wait 1 h → notify owner");
  });
});

describe("scheduled workflow dates", () => {
  it("reaches only clients who crossed the no-visit line in the last week", () => {
    const now = new Date("2027-03-10T17:00:00Z");
    const w = noVisitWindow(now, 60);
    expect(w.to.toISOString()).toBe("2027-01-09T17:00:00.000Z");
    expect(w.from.toISOString()).toBe("2027-01-02T17:00:00.000Z");
  });
  it("celebrates 29 February birthdays on the 28th in years without one", () => {
    expect(birthdayKeys("2027-02-28")).toEqual(["02-28", "02-29"]);
    expect(birthdayKeys("2028-02-28")).toEqual(["02-28"]);
    expect(birthdayKeys("2028-02-29")).toEqual(["02-29"]);
    expect(birthdayKeys("2027-07-04")).toEqual(["07-04"]);
  });
});
