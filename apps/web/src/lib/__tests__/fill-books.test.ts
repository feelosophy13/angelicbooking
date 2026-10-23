import { describe, expect, it } from "vitest";
import { groupGaps, histories, inviteChannel, pickClients, renderInvite, slotPath, type PickInput, type Visit } from "@/lib/fill-books";

const NOW = new Date("2026-10-22T12:00:00Z");
const DAY = 86_400_000;
const at = (hhmm: string, day = "2026-10-23") => new Date(`${day}T${hhmm}:00Z`);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("groupGaps", () => {
  it("joins consecutive starts into one gap that ends a service-length after the last start", () => {
    const slots = ["09:00", "09:15", "09:30", "13:00", "13:15"].map((t) => at(t));
    const gaps = groupGaps(slots, 15, 60);
    expect(gaps.map((g) => [g.start.toISOString().slice(11, 16), g.end.toISOString().slice(11, 16), g.minutes])).toEqual([
      ["09:00", "10:30", 90],
      ["13:00", "14:15", 75],
    ]);
  });
  it("is empty without slots and copes with unsorted input", () => {
    expect(groupGaps([], 15, 60)).toEqual([]);
    expect(groupGaps([at("10:15"), at("10:00")], 15, 30)).toHaveLength(1);
  });
});

const visit = (clientId: string, ago: number, staffId = "s1", serviceId = "cut"): Visit => ({ clientId, at: daysAgo(ago), staffId, serviceId });

function input(visits: Visit[], extra: Partial<PickInput> = {}): PickInput {
  return {
    opening: { staffId: "s1", date: "2026-10-23", start: at("13:00"), end: at("15:00"), locationId: null },
    now: NOW,
    histories: histories(visits, NOW),
    waitlist: [],
    booked: new Set(),
    recentlyInvited: new Set(),
    invitedHere: new Set(),
    performs: new Set(["cut", "color"]),
    minutesOf: new Map([["cut", 60], ["color", 180]]),
    typicalServiceId: "cut",
    activeStaff: new Set(["s1", "s2"]),
    lapsedAfterDays: 90,
    staffName: () => "Jamie",
    ...extra,
  };
}

describe("histories", () => {
  it("finds the usual gap (median), stylist and service", () => {
    const h = histories([visit("a", 100), visit("a", 70), visit("a", 40, "s1", "color"), visit("a", 10)], NOW).get("a")!;
    expect(h.visits).toBe(4);
    expect(h.usualGapDays).toBe(30);
    expect(h.usualStaffId).toBe("s1");
    expect(h.usualServiceId).toBe("cut");
    expect(h.byStaff.get("s1")).toBe(4);
  });
});

describe("pickClients", () => {
  it("puts the day's waitlist first, then clients due back, then regulars", () => {
    const visits = [
      // due: every 30 days, last 40 days ago
      visit("due", 100), visit("due", 70), visit("due", 40),
      // regular: four visits with s1, every 30 days, last 20 days ago (not due yet)
      visit("reg", 110), visit("reg", 80), visit("reg", 50), visit("reg", 20),
    ];
    const picks = pickClients(input(visits, { waitlist: [{ id: "w", clientId: "wl", date: "2026-10-23", serviceId: null, staffId: null, locationId: null }] }));
    expect(picks.map((p) => [p.clientId, p.reason])).toEqual([["wl", "waitlist"], ["due", "overdue"], ["reg", "regular"]]);
    expect(picks[0]!.serviceId).toBe("cut"); // no service on the entry: the stylist's typical one
  });

  it("never picks someone booked ahead, invited recently, or already invited here", () => {
    const visits = [visit("a", 100), visit("a", 70), visit("a", 40), visit("b", 100), visit("b", 70), visit("b", 40), visit("c", 100), visit("c", 70), visit("c", 40)];
    const picks = pickClients(input(visits, { booked: new Set(["a"]), recentlyInvited: new Set(["b"]), invitedHere: new Set(["c"]) }));
    expect(picks).toEqual([]);
  });

  it("offers only a service that fits the gap and that the stylist does", () => {
    const visits = [visit("long", 100, "s1", "color"), visit("long", 70, "s1", "color"), visit("long", 40, "s1", "color"), visit("other", 100, "s1", "perm"), visit("other", 70, "s1", "perm"), visit("other", 40, "s1", "perm")];
    expect(pickClients(input(visits))).toEqual([]); // a 3-hour color in a 2-hour gap; a perm Jamie doesn't do
  });

  it("leaves another stylist's clients alone unless their stylist has left", () => {
    const visits = [visit("x", 100, "s2"), visit("x", 70, "s2"), visit("x", 40, "s2"), visit("y", 100, "gone"), visit("y", 70, "gone"), visit("y", 40, "gone")];
    expect(pickClients(input(visits)).map((p) => p.clientId)).toEqual(["y"]);
  });

  it("uses the lapsed-after days for a one-visit client and skips long-gone ones", () => {
    const one = [visit("once", 95)];
    expect(pickClients(input(one)).map((p) => p.reason)).toEqual(["overdue"]);
    expect(pickClients(input([visit("gone", 400)]))).toEqual([]);
    expect(pickClients(input([visit("soon", 30)]))).toEqual([]);
  });

  it("skips a waitlist entry for a different stylist or another day", () => {
    const picks = pickClients(input([], { waitlist: [
      { id: "1", clientId: "p", date: "2026-10-23", serviceId: null, staffId: "s2", locationId: null },
      { id: "2", clientId: "q", date: "2026-10-24", serviceId: null, staffId: null, locationId: null },
    ] }));
    expect(picks).toEqual([]);
  });
});

describe("inviteChannel (consent)", () => {
  const base = { phone: "+15555550101", email: "a@example.com", smsOptIn: true, smsMarketingOptIn: true, emailOptIn: true, emailMarketingOptIn: true };
  const ready = { waitlist: false, suppressed: false, smsReady: true, emailReady: true, hasPostalAddress: true };
  it("texts when marketing-text consent is given", () => {
    expect(inviteChannel(base, ready)).toBe("sms");
  });
  it("never texts a number that replied STOP", () => {
    expect(inviteChannel(base, { ...ready, suppressed: true })).toBe("email");
  });
  it("needs marketing consent, except for the waitlist", () => {
    const noMarketing = { ...base, smsMarketingOptIn: false, emailMarketingOptIn: false };
    expect(inviteChannel(noMarketing, ready)).toBeNull();
    expect(inviteChannel(noMarketing, { ...ready, waitlist: true })).toBe("sms");
  });
  it("respects plain opt-outs even for the waitlist", () => {
    expect(inviteChannel({ ...base, smsOptIn: false, emailOptIn: false }, { ...ready, waitlist: true })).toBeNull();
  });
  it("needs the postal address for marketing email and a verified number for texts", () => {
    const emailOnly = { ...base, smsMarketingOptIn: false };
    expect(inviteChannel(emailOnly, { ...ready, hasPostalAddress: false })).toBeNull();
    expect(inviteChannel(base, { ...ready, smsReady: false })).toBe("email");
  });
});

describe("the invitation", () => {
  it("fills the placeholders and always carries the link", () => {
    const vars = { first_name: "Ana", staff: "Jamie", when: "tomorrow at 1:00 PM", service: "Cut", link: "https://x/book/s?service=1" };
    expect(renderInvite(null, vars)).toBe("Hi Ana, Jamie has an opening tomorrow at 1:00 PM for Cut. Want it? Book in one tap: https://x/book/s?service=1");
    expect(renderInvite("Spot open {when}!", vars)).toBe("Spot open tomorrow at 1:00 PM! https://x/book/s?service=1");
  });
  it("links to the booking page at that exact slot", () => {
    const p = new URLSearchParams(slotPath({ serviceId: "cut", staffId: "s1", date: "2026-10-23", start: at("13:00"), locationId: "loc" }).slice(1));
    expect(Object.fromEntries(p)).toEqual({ location: "loc", service: "cut", staff: "s1", date: "2026-10-23", time: "2026-10-23T13:00:00.000Z" });
  });
});
