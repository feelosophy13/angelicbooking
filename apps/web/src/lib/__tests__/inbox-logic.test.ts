/** Inbox helpers with no database: ordering, filters, delivery wording, quick replies, short times. */
import { describe, expect, it } from "vitest";
import { automatedLabel, dayLabel, deliveryLabel, filterConversations, groupByDay, sortConversations, whenShort } from "../inbox";
import { DEFAULT_QUICK_REPLIES, normalizeQuickReplies, quickRepliesFor, renderQuickReply } from "../notify/quick-replies";

const at = (minsAgo: number) => new Date(Date.UTC(2026, 9, 18, 18, 0) - minsAgo * 60_000);
const convo = (o: Partial<{ unread: number; lastAt: Date; lastDir: "in" | "out"; smsOptIn: boolean; name: string }>) => ({ unread: 0, lastAt: at(0), lastDir: "in" as const, smsOptIn: true, name: "x", ...o });

describe("conversation order and filters", () => {
  it("puts unread first, then newest, so the desk's work is at the top", () => {
    const list = [convo({ name: "read-new", lastAt: at(1) }), convo({ name: "unread-old", unread: 1, lastAt: at(500) }), convo({ name: "read-old", lastAt: at(900) }), convo({ name: "unread-new", unread: 2, lastAt: at(10) })];
    expect(sortConversations(list).map((c) => c.name)).toEqual(["unread-new", "unread-old", "read-new", "read-old"]);
  });
  it("filters to unread, needs reply (the client spoke last) and opted out", () => {
    const list = [convo({ name: "a", unread: 1 }), convo({ name: "b", lastDir: "out" }), convo({ name: "c", smsOptIn: false, lastDir: "out" })];
    expect(filterConversations(list, "unread").map((c) => c.name)).toEqual(["a"]);
    expect(filterConversations(list, "needs_reply").map((c) => c.name)).toEqual(["a"]);
    expect(filterConversations(list, "opted_out").map((c) => c.name)).toEqual(["c"]);
    expect(filterConversations(list, "all")).toHaveLength(3);
  });
});

describe("delivery wording", () => {
  it("says where a text stands, with the reason when it stopped, and offers a retry only then", () => {
    expect(deliveryLabel({ status: "queued" })).toMatchObject({ text: "Waiting to send", retry: false });
    expect(deliveryLabel({ status: "queued", error: "Twilio busy (retrying)" })).toMatchObject({ text: "Trying again · Twilio busy", tone: "wait" });
    expect(deliveryLabel({ status: "sending" })).toMatchObject({ text: "Sending…" });
    expect(deliveryLabel({ status: "sent" })).toMatchObject({ text: "Sent", tone: "muted", retry: false });
    expect(deliveryLabel({ status: "sent", deliveryStatus: "delivered" })).toMatchObject({ text: "Delivered", tone: "ok" });
    expect(deliveryLabel({ status: "failed", error: "The number is a landline or cannot get texts" })).toMatchObject({ text: "Not delivered · The number is a landline or cannot get texts", tone: "bad", retry: true });
    expect(deliveryLabel({ status: "skipped", error: "Demo business: nothing is sent" })).toMatchObject({ text: "Not sent · Demo business: nothing is sent", tone: "muted", retry: true });
  });
  it("names automated texts and leaves a staff reply unlabelled", () => {
    expect(automatedLabel("reminder")).toBe("Reminder");
    expect(automatedLabel("forms_nudge")).toBe("Forms reminder");
    expect(automatedLabel("staff_reply")).toBeNull();
    expect(automatedLabel("birthday_wish")).toBe("Birthday wish");
  });
});

describe("quick replies", () => {
  it("fills in the client's name and next visit, with plain words when there is no visit", () => {
    const body = "Hi {first_name}, still good for {service} on {next_appointment} with {staff}? – {business}";
    expect(renderQuickReply(body, { firstName: "Ann", business: "Luxe", next: { when: "Fri, Oct 23, 2:00 PM", service: "Lash fill", staff: "Jordan" } })).toBe("Hi Ann, still good for Lash fill on Fri, Oct 23, 2:00 PM with Jordan? – Luxe");
    expect(renderQuickReply(body, { firstName: "", business: "Luxe", next: null })).toBe("Hi there, still good for your appointment on your next appointment with us? – Luxe");
  });
  it("uses the defaults until the business saves its own, and cleans what it saves", () => {
    expect(quickRepliesFor({ quickReplies: [] })).toBe(DEFAULT_QUICK_REPLIES);
    expect(quickRepliesFor({ quickReplies: [{ title: "Hi", body: "Hello" }] })).toEqual([{ title: "Hi", body: "Hello" }]);
    expect(normalizeQuickReplies([{ title: "  ", body: "  Thanks {first_name}!  " }, { title: "Empty", body: "   " }])).toEqual([{ title: "Thanks {first_name}!", body: "Thanks {first_name}!" }]);
    expect(normalizeQuickReplies(Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, body: `b${i}` })))).toHaveLength(20);
  });
});

describe("short times", () => {
  const tz = "America/New_York";
  const now = new Date("2026-10-18T18:00:00Z"); // 2:00 PM in New York on a Sunday
  it("shows the time today, Yesterday, a weekday this week, else the date", () => {
    expect(whenShort(new Date("2026-10-18T15:06:00Z"), tz, now)).toBe("11:06 AM");
    expect(whenShort(new Date("2026-10-17T23:30:00Z"), tz, now)).toBe("Yesterday");
    expect(whenShort(new Date("2026-10-15T12:00:00Z"), tz, now)).toBe("Thu");
    expect(whenShort(new Date("2026-10-03T12:00:00Z"), tz, now)).toBe("Oct 3");
    expect(whenShort(new Date("2025-12-24T12:00:00Z"), tz, now)).toBe("Dec 24, 2025");
  });
  it("groups a thread by day with Today / Yesterday / the date", () => {
    const items = [{ at: new Date("2026-10-03T12:00:00Z") }, { at: new Date("2026-10-03T13:00:00Z") }, { at: new Date("2026-10-17T20:00:00Z") }, { at: new Date("2026-10-18T15:00:00Z") }];
    expect(groupByDay(items, tz, now).map((g) => [g.label, g.items.length])).toEqual([["Saturday, October 3", 2], ["Yesterday", 1], ["Today", 1]]);
    expect(dayLabel(new Date("2025-12-24T12:00:00Z"), tz, now)).toBe("Wednesday, December 24, 2025");
  });
});
