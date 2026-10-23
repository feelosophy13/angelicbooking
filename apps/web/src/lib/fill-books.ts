/**
 * Fill My Books, the parts that need no database: turning a stylist's open start times into openings, choosing which clients to
 * invite to one, and which channel (if any) consent allows. server/fill-books.ts feeds these from the database and sends.
 */

const DAY = 86_400_000;

/** A run of free time for one stylist: the first open start, and when the free time ends. */
export type Gap = { start: Date; end: Date; minutes: number };

/**
 * Open start times (from availability, for the stylist's typical service) grouped into gaps. Consecutive starts one slot interval apart
 * belong to the same gap; the gap runs until the last start plus the service's length (`serviceMin`, including any cleanup after).
 */
export function groupGaps(slots: Date[], intervalMin: number, serviceMin: number): Gap[] {
  const sorted = [...slots].sort((a, b) => a.getTime() - b.getTime());
  const gaps: Gap[] = [];
  let first: Date | null = null;
  let last: Date | null = null;
  const close = () => {
    if (!first || !last) return;
    const end = new Date(last.getTime() + serviceMin * 60_000);
    gaps.push({ start: first, end, minutes: Math.round((end.getTime() - first.getTime()) / 60_000) });
  };
  for (const s of sorted) {
    if (last && s.getTime() - last.getTime() <= intervalMin * 60_000) {
      last = s;
      continue;
    }
    close();
    first = s;
    last = s;
  }
  close();
  return gaps;
}

/** One completed visit (the first service of the appointment). */
export type Visit = { clientId: string; at: Date; staffId: string | null; serviceId: string | null };

/** What a client's history says about them. */
export type ClientHistory = {
  clientId: string;
  visits: number;
  lastVisit: Date;
  /** Median days between visits; null with only one visit. */
  usualGapDays: number | null;
  usualStaffId: string | null;
  usualServiceId: string | null;
  /** Completed visits per stylist in the last year. */
  byStaff: Map<string, number>;
  /** Most frequent service with each stylist. */
  serviceByStaff: Map<string, string>;
};

const mostFrequent = (xs: (string | null)[]): string | null => {
  const n = new Map<string, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, v] of n) if (best === null || v > n.get(best)!) best = k;
  return best;
};

/** Build each client's history from their completed visits. */
export function histories(visits: Visit[], now: Date): Map<string, ClientHistory> {
  const byClient = new Map<string, Visit[]>();
  for (const v of visits) byClient.set(v.clientId, [...(byClient.get(v.clientId) ?? []), v]);
  const out = new Map<string, ClientHistory>();
  for (const [clientId, list] of byClient) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    const gaps = list.slice(1).map((v, i) => (v.at.getTime() - list[i]!.at.getTime()) / DAY).filter((d) => d >= 1).sort((a, b) => a - b);
    const recent = list.filter((v) => now.getTime() - v.at.getTime() <= 365 * DAY);
    const byStaff = new Map<string, number>();
    for (const v of recent) if (v.staffId) byStaff.set(v.staffId, (byStaff.get(v.staffId) ?? 0) + 1);
    const serviceByStaff = new Map<string, string>();
    for (const staffId of new Set(list.map((v) => v.staffId).filter((s): s is string => !!s))) {
      const s = mostFrequent(list.filter((v) => v.staffId === staffId).map((v) => v.serviceId));
      if (s) serviceByStaff.set(staffId, s);
    }
    out.set(clientId, {
      clientId,
      visits: list.length,
      lastVisit: list[list.length - 1]!.at,
      usualGapDays: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]!) : null,
      usualStaffId: mostFrequent((recent.length ? recent : list).map((v) => v.staffId)),
      usualServiceId: mostFrequent(list.map((v) => v.serviceId)),
      byStaff,
      serviceByStaff,
    });
  }
  return out;
}

export type FillReason = "waitlist" | "overdue" | "regular";

/** An opening on a stylist's calendar that invitations can go out for. */
export type Opening = { staffId: string; date: string; start: Date; end: Date; locationId: string | null };

export type WaitlistEntry = { id: string; clientId: string | null; date: string; serviceId: string | null; staffId: string | null; locationId: string | null };

export type Candidate = { clientId: string; reason: FillReason; serviceId: string; detail: string };

export type PickInput = {
  opening: Opening;
  now: Date;
  histories: Map<string, ClientHistory>;
  waitlist: WaitlistEntry[];
  /** Clients with something booked from now on. */
  booked: Set<string>;
  /** Clients invited recently (to anything): not invited again yet. */
  recentlyInvited: Set<string>;
  /** Clients already invited to this very opening. */
  invitedHere: Set<string>;
  /** Service ids this stylist performs (and that can be booked online). */
  performs: Set<string>;
  /** Total minutes (including cleanup) of each such service. */
  minutesOf: Map<string, number>;
  /** The stylist's typical service, for a waitlist entry that names none. */
  typicalServiceId: string;
  activeStaff: Set<string>;
  lapsedAfterDays: number;
  /** Stylist names, for the reason line. */
  staffName: (id: string) => string;
};

const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

/**
 * Who to invite to an opening, best first:
 *   1. the waitlist for that day (an entry for this stylist or for anyone; a named service must be one this stylist does);
 *   2. clients due back by the opening (their usual gap between visits, or the business's lapsed-after days when there is only one
 *      visit) whose usual stylist is this one, or whose usual stylist has left; not long-gone ones (that is win-back's job);
 *   3. this stylist's regulars (three or more visits with them in a year) who aren't due yet but are at least two weeks out.
 * Never someone with a booking ahead, someone invited in the last few days, or someone already invited to this opening. The service
 * offered must fit the gap.
 */
export function pickClients(p: PickInput): Candidate[] {
  const { opening, now } = p;
  const free = (opening.end.getTime() - opening.start.getTime()) / 60_000;
  const fits = (serviceId: string | null | undefined): serviceId is string => !!serviceId && p.performs.has(serviceId) && (p.minutesOf.get(serviceId) ?? Infinity) <= free;
  const skip = (id: string) => p.booked.has(id) || p.recentlyInvited.has(id) || p.invitedHere.has(id);
  const out: Candidate[] = [];
  const taken = new Set<string>();
  const add = (c: Candidate) => {
    if (taken.has(c.clientId)) return;
    taken.add(c.clientId);
    out.push(c);
  };

  // 1. Waitlist: this stylist first, then anyone.
  const wl = p.waitlist
    .filter((w) => w.clientId && w.date === opening.date && (!w.staffId || w.staffId === opening.staffId) && (!w.locationId || !opening.locationId || w.locationId === opening.locationId))
    .sort((a, b) => Number(!!b.staffId) - Number(!!a.staffId));
  for (const w of wl) {
    const h = p.histories.get(w.clientId!);
    const serviceId = w.serviceId ?? h?.serviceByStaff.get(opening.staffId) ?? h?.usualServiceId ?? p.typicalServiceId;
    if (skip(w.clientId!) || !fits(serviceId)) continue;
    add({ clientId: w.clientId!, reason: "waitlist", serviceId, detail: w.staffId ? `On the waitlist for ${p.staffName(opening.staffId)} that day` : "On the waitlist for that day" });
  }

  // 2. Due back by the opening, most overdue first.
  const due: (Candidate & { ratio: number })[] = [];
  for (const h of p.histories.values()) {
    if (skip(h.clientId) || taken.has(h.clientId)) continue;
    const mine = h.usualStaffId === opening.staffId || (!!h.usualStaffId && !p.activeStaff.has(h.usualStaffId)) || !h.usualStaffId;
    if (!mine) continue;
    const every = h.usualGapDays ?? p.lapsedAfterDays;
    const sinceAtOpening = daysBetween(h.lastVisit, opening.start);
    // Long gone (three usual gaps, and past twice the lapsed mark): win-back, not a last-minute slot.
    if (sinceAtOpening < every || sinceAtOpening > Math.max(every * 3, p.lapsedAfterDays * 2)) continue;
    const serviceId = h.serviceByStaff.get(opening.staffId) ?? h.usualServiceId;
    if (!fits(serviceId)) continue;
    const weeks = (d: number) => (d >= 14 ? `${Math.round(d / 7)} weeks` : `${Math.round(d)} days`);
    const since = daysBetween(h.lastVisit, now);
    due.push({ clientId: h.clientId, reason: "overdue", serviceId, ratio: sinceAtOpening / every, detail: h.usualGapDays ? `Usually every ${weeks(h.usualGapDays)}; last visit ${weeks(since)} ago` : `Last visit ${weeks(since)} ago` });
  }
  for (const c of due.sort((a, b) => b.ratio - a.ratio)) add({ clientId: c.clientId, reason: c.reason, serviceId: c.serviceId, detail: c.detail });

  // 3. Regulars of this stylist, most visits first.
  const regulars: (Candidate & { n: number })[] = [];
  for (const h of p.histories.values()) {
    if (skip(h.clientId) || taken.has(h.clientId)) continue;
    const n = h.byStaff.get(opening.staffId) ?? 0;
    if (n < 3) continue;
    const since = daysBetween(h.lastVisit, now);
    if (since < Math.max(14, (h.usualGapDays ?? 0) * 0.6)) continue;
    const serviceId = h.serviceByStaff.get(opening.staffId) ?? h.usualServiceId;
    if (!fits(serviceId)) continue;
    regulars.push({ clientId: h.clientId, reason: "regular", serviceId, n, detail: `${n} visits with ${p.staffName(opening.staffId)} this year` });
  }
  for (const c of regulars.sort((a, b) => b.n - a.n)) add({ clientId: c.clientId, reason: c.reason, serviceId: c.serviceId, detail: c.detail });
  return out;
}

export type ConsentClient = { phone: string | null; email: string | null; smsOptIn: boolean; smsMarketingOptIn: boolean; emailOptIn: boolean; emailMarketingOptIn: boolean };

/**
 * How an invitation may reach this client, text first. An invitation is marketing (the client didn't ask for it), so it needs marketing
 * consent on that channel, except for someone on the waitlist, who asked to hear about that day: their ordinary text or email consent
 * is enough. A number that replied STOP is never texted. Email marketing also needs the salon's postal address (CAN-SPAM).
 */
export function inviteChannel(c: ConsentClient, opts: { waitlist: boolean; suppressed: boolean; smsReady: boolean; emailReady: boolean; hasPostalAddress: boolean }): "sms" | "email" | null {
  const sms = !!c.phone?.trim() && opts.smsReady && !opts.suppressed && c.smsOptIn && (opts.waitlist || c.smsMarketingOptIn);
  if (sms) return "sms";
  const email = !!c.email?.trim() && opts.emailReady && c.emailOptIn && (opts.waitlist || (c.emailMarketingOptIn && opts.hasPostalAddress));
  return email ? "email" : null;
}

/** Why a candidate can't be invited, for the screen. */
export function noChannelReason(c: ConsentClient): string {
  if (!c.phone && !c.email) return "No phone or email";
  return "No consent to marketing texts or emails";
}

export const DEFAULT_FILL_MESSAGE = "Hi {first_name}, {staff} has an opening {when} for {service}. Want it? Book in one tap: {link}";

export function renderInvite(template: string | null, vars: { first_name: string; staff: string; when: string; service: string; link: string }): string {
  const t = template?.trim() || DEFAULT_FILL_MESSAGE;
  const body = t.replace(/\{(first_name|staff|when|service|link)\}/g, (_, k: keyof typeof vars) => vars[k]);
  return t.includes("{link}") ? body : `${body} ${vars.link}`;
}

/** The booking page opened at that exact slot (service, stylist, day and time chosen), ready for the client's details. */
export function slotPath(o: { serviceId: string; staffId: string; date: string; start: Date; locationId?: string | null }): string {
  const p = new URLSearchParams();
  if (o.locationId) p.set("location", o.locationId);
  p.set("service", o.serviceId);
  p.set("staff", o.staffId);
  p.set("date", o.date);
  p.set("time", o.start.toISOString());
  return `?${p.toString()}`;
}

/** Invitations wait for daytime where the client is; one that couldn't go out at least two hours before the slot isn't sent. */
export const MIN_LEAD_MS = 2 * 3_600_000;
/** Don't invite the same client to anything again for this long. */
export const INVITE_COOLDOWN_DAYS = 5;
/** A booking this soon after an invitation counts as filled by it. */
export const FILL_ATTRIBUTION_DAYS = 3;
