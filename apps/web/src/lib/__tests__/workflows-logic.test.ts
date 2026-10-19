import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "@angelic/db";
import { birthdayKeys, consentLine, deferToDaytime, hoursBeforeStep, matchesFilters, messageConsent, noVisitWindow, runOutcome, summarizeSteps, validateSteps, waitResumesAt } from "../workflows-logic";

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

describe("messageConsent", () => {
  const wait = (hours: number, mode: "delay" | "before_appointment" | "after_appointment" = "delay"): WorkflowStep => ({ id: `w${hours}`, type: "wait", mode, hours });
  const sms: WorkflowStep = { id: "s", type: "sms", body: "hi" };
  const email: WorkflowStep = { id: "e", type: "email", subject: "s", body: "b" };
  it("adds up the waits before a step, restarting the clock at an after-the-visit wait", () => {
    expect(hoursBeforeStep([wait(20, "after_appointment"), sms], 1)).toBe(20);
    expect(hoursBeforeStep([wait(2), wait(3), sms, wait(100), email], 2)).toBe(5);
    expect(hoursBeforeStep([wait(2), wait(3), sms, wait(100), email], 4)).toBe(105);
    expect(hoursBeforeStep([wait(5), wait(48, "after_appointment"), sms], 2)).toBe(48);
    expect(hoursBeforeStep([sms], 0)).toBe(0);
  });
  it("treats aftercare and welcome messages within 72 hours as part of the visit, later ones as marketing", () => {
    expect(messageConsent("appointment_completed", [wait(20, "after_appointment"), sms], 1)).toEqual({ marketing: false, quietHours: true });
    expect(messageConsent("appointment_completed", [wait(72), sms], 1).marketing).toBe(false);
    expect(messageConsent("appointment_completed", [wait(28 * 24), email], 1).marketing).toBe(true);
    expect(messageConsent("client_created", [wait(1), email], 1).marketing).toBe(false);
    expect(messageConsent("client_created", [wait(1), email, wait(7 * 24), email], 3).marketing).toBe(true);
  });
  it("keeps birthday and no-visit messages marketing and everything else transactional", () => {
    expect(messageConsent("birthday", [email], 0).marketing).toBe(true);
    expect(messageConsent("no_visit", [email], 0).marketing).toBe(true);
    expect(messageConsent("appointment_no_show", [wait(1), sms], 1).marketing).toBe(false);
    expect(messageConsent("membership_payment_failed", [email], 0).marketing).toBe(false);
    expect(messageConsent("review_submitted", [sms], 0).marketing).toBe(false);
  });
  it("holds every text for daytime except the booked and cancelled confirmations", () => {
    expect(messageConsent("appointment_booked", [sms], 0).quietHours).toBe(false);
    expect(messageConsent("appointment_cancelled", [sms], 0).quietHours).toBe(false);
    expect(messageConsent("appointment_no_show", [wait(1), sms], 1).quietHours).toBe(true);
    expect(messageConsent("form_submitted", [sms], 0).quietHours).toBe(true);
    expect(messageConsent("no_visit", [sms], 0).quietHours).toBe(true);
  });
  it("tells the editor which consent each message step needs", () => {
    expect(consentLine(sms, "appointment_completed", [wait(20, "after_appointment"), sms], 1)).toMatch(/^Appointment text: needs text consent only; sent 9am/);
    expect(consentLine(sms, "appointment_booked", [sms], 0)).toMatch(/goes out right away/);
    expect(consentLine(sms, "no_visit", [sms], 0)).toMatch(/^Marketing text: needs the client's written consent/);
    expect(consentLine(email, "appointment_completed", [wait(28 * 24), email], 1)).toMatch(/^Marketing email/);
    expect(consentLine(email, "membership_payment_failed", [email], 0)).toMatch(/^Transactional email/);
    expect(consentLine(wait(1), "birthday", [wait(1)], 0)).toBeNull();
  });
});

describe("runOutcome", () => {
  type Event = Parameters<typeof runOutcome>[0]["log"][number]["event"];
  // A step's own line carries its index; what delivery appends later has none.
  const step = (event: Event) => ({ at: "2026-10-18T12:00:00Z", step: 0, event, detail: event });
  const delivery = (event: Event) => ({ at: "2026-10-18T12:05:00Z", step: null, event, detail: event });
  it("reads what was actually sent, not that something was queued", () => {
    expect(runOutcome({ status: "active", log: [step("started"), step("waiting")] })).toBe("active");
    expect(runOutcome({ status: "cancelled", log: [step("started"), step("cancelled")] })).toBe("cancelled");
    expect(runOutcome({ status: "failed", log: [step("started"), step("failed")] })).toBe("failed");
    expect(runOutcome({ status: "done", log: [step("started"), step("queued"), step("done")] })).toBe("queued");
    expect(runOutcome({ status: "done", log: [step("started"), step("queued"), step("done"), delivery("sent")] })).toBe("sent");
    expect(runOutcome({ status: "done", log: [step("started"), step("queued"), step("done"), delivery("skipped")] })).toBe("skipped");
    expect(runOutcome({ status: "done", log: [step("started"), step("skipped"), step("done")] })).toBe("skipped");
    expect(runOutcome({ status: "done", log: [step("started"), step("queued"), step("queued"), step("done"), delivery("sent"), delivery("failed")] })).toBe("failed");
    expect(runOutcome({ status: "done", log: [step("started"), step("action"), step("done")] })).toBe("done");
  });
});
