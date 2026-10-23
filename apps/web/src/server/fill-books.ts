/**
 * Fill My Books (Marketing → Fill open slots): find the open slots on each stylist's calendar over the next few days, pick clients
 * likely to want them, and send each a personal text or email with a one-tap link to that exact slot on the booking page.
 *
 *   - Openings come from availability (server/availability.ts) for the stylist's typical service, so working hours, time off,
 *     location hours, classes and every booking are respected; a gap must fit that service.
 *   - Clients come from lib/fill-books.ts (waitlist, due back, regulars). Consent decides the channel, and an invitation is a
 *     marketing message unless the client is on that day's waitlist; the delivery step checks consent and STOP again at send time.
 *   - Limits: at most `fillMaxPerSlot` invitations to one opening ever, `fillMaxPerDay` a day, nobody twice within
 *     INVITE_COOLDOWN_DAYS, nobody with a booking ahead. Texts wait for daytime; one that couldn't go out two hours before the slot
 *     isn't sent. A taken slot stops being an opening, so nobody else is invited to it, and the booking page tells late clickers.
 *   - A booking by an invited client within FILL_ATTRIBUTION_DAYS counts as filled by the invitation (recordFillBookings).
 * Nothing actually leaves a demo business (lib/notify skips them).
 */
import { after } from "next/server";
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { instantToISODate, normalizePhone } from "@angelic/core";
import { getStaffAvailability, getStaffAvailabilityForDates, timingFor } from "./availability";
import { phoneTail, suppressedTails } from "./consent";
import { postalAddress } from "./locations";
import { smsAvailableFor } from "./messaging";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { siteUrl } from "@/lib/site-url";
import { shiftISODate, formatTime } from "@/lib/utils";
import { deferToDaytime } from "@/lib/workflows-logic";
import { emailConfigured } from "@/lib/notify/providers";
import { marketingEmail } from "@/lib/notify/templates";
import { smsWithStopNotice } from "@/lib/notify/sms";
import { deliverMany } from "@/lib/notify";
import { reportError } from "@/lib/report-error";
import {
  FILL_ATTRIBUTION_DAYS,
  INVITE_COOLDOWN_DAYS,
  MIN_LEAD_MS,
  groupGaps,
  histories,
  inviteChannel,
  noChannelReason,
  pickClients,
  renderInvite,
  slotPath,
  type Candidate,
  type Opening,
  type WaitlistEntry,
} from "@/lib/fill-books";

type Business = typeof schema.businesses.$inferSelect;
const DAY = 86_400_000;
/** Suggestions shown per opening. */
const SHOW_PER_OPENING = 6;

export type Suggestion = Candidate & { name: string; serviceName: string; channel: "sms" | "email" | null; blocked: string | null };
export type FillOpening = Opening & {
  key: string;
  staffName: string;
  locationName: string | null;
  minutes: number;
  invited: { clientId: string; name: string; at: Date; booked: boolean }[];
  /** Invitations this opening may still take. */
  remaining: number;
  suggestions: Suggestion[];
};

export const openingKey = (o: { staffId: string; start: Date; locationId: string | null }) => `${o.staffId}|${o.start.toISOString()}|${o.locationId ?? ""}`;

/** "tomorrow at 2:00 PM", "Thursday at 10:30 AM", or "Mon, Nov 3 at 9:00 AM" beyond a week. */
export function whenLabel(start: Date, timeZone: string, now: Date): string {
  const day = instantToISODate(start, timeZone);
  const today = instantToISODate(now, timeZone);
  const t = formatTime(start, timeZone);
  if (day === today) return `today at ${t}`;
  if (day === shiftISODate(today, 1)) return `tomorrow at ${t}`;
  const opts: Intl.DateTimeFormatOptions = start.getTime() - now.getTime() < 6 * DAY ? { weekday: "long", timeZone } : { weekday: "short", month: "short", day: "numeric", timeZone };
  return `${new Intl.DateTimeFormat("en-US", opts).format(start)} at ${t}`;
}

/** Invitations sent today (business-local), by hand or automatically: the daily cap counts both. */
async function sentToday(tx: TenantDb, business: Business, now: Date): Promise<number> {
  const today = instantToISODate(now, business.timezone);
  const [row] = await tx.select({ n: sql<number>`count(*)` }).from(schema.fillInvites).where(sql`(${schema.fillInvites.createdAt} at time zone ${business.timezone})::date = ${today}::date`);
  return Number(row?.n ?? 0);
}

/**
 * Every opening in the next `fillDaysAhead` days with its suggested clients. `only` narrows to one opening (the Send button), which
 * keeps sending honest: the server only invites clients it would have suggested itself.
 */
export async function findOpenings(business: Business, now = new Date(), only?: { staffId: string; start: Date; locationId: string | null }): Promise<{ openings: FillOpening[]; sentToday: number }> {
  const tz = business.timezone;
  const days = Math.min(14, Math.max(1, business.fillDaysAhead));
  const today = instantToISODate(now, tz);
  const dates = only ? [instantToISODate(only.start, tz)] : Array.from({ length: days }, (_, i) => shiftISODate(today, i));
  const notBefore = new Date(now.getTime() + Math.max(business.minNoticeMin, 60) * 60_000);

  const data = await withTenant(business.id, async (tx) => {
    const [locations, staff, services, mapping, recentItems, visits, bookedRows, waitlist, invites, sent] = await Promise.all([
      tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(asc(schema.locations.name)),
      tx.select({ id: schema.staff.id, name: schema.staff.displayName, active: schema.staff.active, bookable: sql<boolean>`${schema.staff.active} and ${schema.staff.takesAppointments} and ${schema.staff.bookableOnline}` }).from(schema.staff).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
      tx.select().from(schema.services).where(and(eq(schema.services.active, true), eq(schema.services.bookableOnline, true), eq(schema.services.capacity, 1))),
      tx.select({ staffId: schema.staffServices.staffId, serviceId: schema.staffServices.serviceId }).from(schema.staffServices),
      tx
        .select({ staffId: schema.appointmentItems.staffId, serviceId: schema.appointmentItems.serviceId, n: sql<number>`count(*)` })
        .from(schema.appointmentItems)
        .where(and(gte(schema.appointmentItems.startAt, new Date(now.getTime() - 120 * DAY)), notInArray(schema.appointmentItems.status, ["cancelled", "no_show"])))
        .groupBy(schema.appointmentItems.staffId, schema.appointmentItems.serviceId),
      tx
        .select({ clientId: schema.appointments.clientId, at: schema.appointmentItems.startAt, staffId: schema.appointmentItems.staffId, serviceId: schema.appointmentItems.serviceId })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
        .where(and(eq(schema.appointments.status, "completed"), eq(schema.appointments.kind, "visit"), gte(schema.appointmentItems.startAt, new Date(now.getTime() - 730 * DAY)))),
      tx
        .selectDistinct({ clientId: schema.appointments.clientId })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(inArray(schema.appointments.status, ["booked", "confirmed", "checked_in", "in_progress"]), gte(schema.appointmentItems.startAt, now))),
      tx.select().from(schema.waitlist).where(and(eq(schema.waitlist.status, "open"), inArray(schema.waitlist.date, dates))),
      tx
        .select({ clientId: schema.fillInvites.clientId, staffId: schema.fillInvites.staffId, slotStart: schema.fillInvites.slotStart, createdAt: schema.fillInvites.createdAt, booked: sql<boolean>`${schema.fillInvites.bookedAppointmentId} is not null` })
        .from(schema.fillInvites)
        .where(gte(schema.fillInvites.createdAt, new Date(now.getTime() - Math.max(INVITE_COOLDOWN_DAYS, 16) * DAY))),
      sentToday(tx, business, now),
    ]);
    return { locations, staff, services, mapping, recentItems, visits, bookedRows, waitlist, invites, sent };
  });

  const { locations, staff, services, mapping, recentItems, sent } = data;
  const minutesOf = new Map(services.map((s) => [s.id, s.durationMin + s.gapMin + s.finishMin + s.bufferAfterMin]));
  const restricted = new Set(mapping.map((m) => m.serviceId));
  const performsOf = (staffId: string) => new Set(services.filter((s) => !restricted.has(s.id) || mapping.some((m) => m.staffId === staffId && m.serviceId === s.id)).map((s) => s.id));
  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? "Your stylist";
  const activeStaff = new Set(staff.filter((s) => s.active).map((s) => s.id));
  const hist = histories(data.visits.filter((v): v is typeof v & { clientId: string } => !!v.clientId), now);
  const booked = new Set(data.bookedRows.map((r) => r.clientId).filter((x): x is string => !!x));
  const recentlyInvited = new Set(data.invites.filter((i) => i.createdAt.getTime() > now.getTime() - INVITE_COOLDOWN_DAYS * DAY).map((i) => i.clientId));
  const waitlist: WaitlistEntry[] = data.waitlist.map((w) => ({ id: w.id, clientId: w.clientId, date: w.date, serviceId: w.serviceId, staffId: w.staffId, locationId: w.locationId }));
  const multi = locations.length > 1;

  const openings: (Opening & { minutes: number; typicalServiceId: string; performs: Set<string> })[] = [];
  for (const person of staff.filter((s) => s.bookable && (!only || s.id === only.staffId))) {
    const performs = performsOf(person.id);
    if (!performs.size) continue;
    // Their typical service: the one they did most in the last four months, else the middle-length one they can do.
    const counts = recentItems.filter((r) => r.staffId === person.id && r.serviceId && performs.has(r.serviceId)).sort((a, b) => Number(b.n) - Number(a.n));
    const byLength = [...performs].sort((a, b) => minutesOf.get(a)! - minutesOf.get(b)!);
    const typicalId = counts[0]?.serviceId ?? byLength[Math.floor(byLength.length / 2)]!;
    const typical = services.find((s) => s.id === typicalId)!;
    for (const loc of multi ? locations : [null]) {
      if (only && (only.locationId ?? null) !== (loc?.id ?? null)) continue;
      const byDate = await getStaffAvailabilityForDates({ businessId: business.id, timeZone: tz, slotIntervalMin: business.slotIntervalMin, staffId: person.id, service: timingFor(typical), notBefore, dates, locationId: loc?.id ?? null });
      for (const date of dates) {
        for (const gap of groupGaps(byDate.get(date) ?? [], business.slotIntervalMin, minutesOf.get(typicalId)!)) {
          if (only && gap.start.getTime() > only.start.getTime()) continue;
          if (only && gap.end.getTime() <= only.start.getTime()) continue;
          // With `only`, the opening starts where the screen said it did (the gap may have shrunk from the front since).
          const start = only ? only.start : gap.start;
          openings.push({ staffId: person.id, date, start, end: gap.end, locationId: loc?.id ?? null, minutes: Math.round((gap.end.getTime() - start.getTime()) / 60_000), typicalServiceId: typicalId, performs });
        }
      }
    }
  }
  openings.sort((a, b) => a.start.getTime() - b.start.getTime() || staffName(a.staffId).localeCompare(staffName(b.staffId)));

  const picks = openings.map((o) => {
    const invitedHere = data.invites.filter((i) => i.staffId === o.staffId && i.slotStart.getTime() >= o.start.getTime() && i.slotStart.getTime() < o.end.getTime());
    const candidates = pickClients({ opening: o, now, histories: hist, waitlist, booked, recentlyInvited, invitedHere: new Set(invitedHere.map((i) => i.clientId)), performs: o.performs, minutesOf, typicalServiceId: o.typicalServiceId, activeStaff, lapsedAfterDays: business.lapsedAfterDays, staffName });
    return { o, invitedHere, candidates: only ? candidates : candidates.slice(0, SHOW_PER_OPENING * 2) };
  });

  // Contact details and consent for everyone suggested or already invited (used here only, never in a prompt).
  const ids = [...new Set(picks.flatMap((p) => [...p.candidates.map((c) => c.clientId), ...p.invitedHere.map((i) => i.clientId)]))];
  const [clients, smsReady, address] = await Promise.all([
    ids.length ? withTenant(business.id, (tx) => tx.select().from(schema.clients).where(inArray(schema.clients.id, ids))) : Promise.resolve([] as (typeof schema.clients.$inferSelect)[]),
    smsAvailableFor(business.id),
    withTenant(business.id, (tx) => postalAddress(tx, business)),
  ]);
  const suppressed = await withTenant(business.id, (tx) => suppressedTails(tx, clients.map((c) => c.phone ?? "")));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "your service";
  const cap = Math.max(1, business.fillMaxPerSlot);

  const result: FillOpening[] = picks.map(({ o, invitedHere, candidates }) => {
    const suggestions: Suggestion[] = [];
    for (const c of candidates) {
      const cl = clientById.get(c.clientId);
      if (!cl) continue;
      const channel = inviteChannel(cl, { waitlist: c.reason === "waitlist", suppressed: suppressed.has(phoneTail(cl.phone)), smsReady, emailReady: emailConfigured(), hasPostalAddress: !!address });
      suggestions.push({ ...c, name: `${cl.firstName} ${cl.lastName}`.trim(), serviceName: serviceName(c.serviceId), channel, blocked: channel ? null : noChannelReason(cl) });
    }
    // Reachable people first; a few unreachable ones stay visible so the desk knows why they weren't offered.
    suggestions.sort((a, b) => Number(!a.channel) - Number(!b.channel));
    return {
      staffId: o.staffId,
      date: o.date,
      start: o.start,
      end: o.end,
      locationId: o.locationId,
      key: openingKey(o),
      staffName: staffName(o.staffId),
      locationName: o.locationId ? (locations.find((l) => l.id === o.locationId)?.name ?? null) : null,
      minutes: o.minutes,
      invited: invitedHere.map((i) => ({ clientId: i.clientId, name: clientById.get(i.clientId) ? `${clientById.get(i.clientId)!.firstName} ${clientById.get(i.clientId)!.lastName}`.trim() : "Client", at: i.createdAt, booked: i.booked })),
      remaining: Math.max(0, cap - invitedHere.length),
      suggestions: only ? suggestions : suggestions.slice(0, SHOW_PER_OPENING),
    };
  });
  return { openings: result, sentToday: sent };
}

export class FillError extends Error {}

/**
 * Invite these clients to one opening. Only clients the server itself suggests for it right now, who consent allows reaching, within
 * the per-slot and daily caps. The exact slot is checked against availability for each client's service before anything is queued.
 * Returns how many were queued. `actorUserId` null = the automatic daily run.
 */
export async function sendFillInvites(business: Business, input: { staffId: string; start: Date; locationId: string | null; clientIds: string[] }, actorUserId: string | null, now = new Date(), opts: { deliverNow?: boolean } = {}): Promise<{ sent: number; skipped: string[] }> {
  const { openings, sentToday: already } = await findOpenings(business, now, { staffId: input.staffId, start: input.start, locationId: input.locationId });
  const opening = openings[0];
  if (!opening) throw new FillError("That opening has been booked or is no longer open.");
  const dailyLeft = Math.max(0, business.fillMaxPerDay - already);
  if (dailyLeft === 0) throw new FillError(`Today's limit of ${business.fillMaxPerDay} invitations is reached. It resets tomorrow (Fill open slots → Settings).`);
  const wanted = new Set(input.clientIds);
  const chosen = opening.suggestions.filter((s) => wanted.has(s.clientId) && s.channel).slice(0, Math.min(opening.remaining, dailyLeft));
  const skipped: string[] = [];
  if (!chosen.length) throw new FillError(opening.remaining === 0 ? `This opening already has ${business.fillMaxPerSlot} invitations out.` : "None of those clients can be invited to this opening any more.");

  const tz = business.timezone;
  const when = whenLabel(opening.start, tz, now);
  const ids = await withTenant(business.id, async (tx) => {
    const address = await postalAddress(tx, business);
    const brand = { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address };
    const notes: (typeof schema.notifications.$inferInsert)[] = [];
    const invites: (typeof schema.fillInvites.$inferInsert)[] = [];
    for (const s of chosen) {
      // The slot must be open for this client's service at exactly that time.
      const service = await tx.query.services.findFirst({ where: eq(schema.services.id, s.serviceId) });
      if (!service) continue;
      const open = await getStaffAvailability({ businessId: business.id, timeZone: tz, slotIntervalMin: business.slotIntervalMin, staffId: opening.staffId, service: timingFor(service), date: opening.date, notBefore: now, locationId: opening.locationId });
      if (!open.some((t) => t.getTime() === opening.start.getTime())) {
        skipped.push(`${s.name}: ${service.name} doesn't fit there any more`);
        continue;
      }
      const cl = await tx.query.clients.findFirst({ where: eq(schema.clients.id, s.clientId) });
      if (!cl) continue;
      const scheduledAt = deferToDaytime(now, tz);
      if (scheduledAt.getTime() > opening.start.getTime() - MIN_LEAD_MS) {
        skipped.push(`${s.name}: too close to the slot to send outside quiet hours`);
        continue;
      }
      const link = siteUrl(business, slotPath({ serviceId: s.serviceId, staffId: opening.staffId, date: opening.date, start: opening.start, locationId: opening.locationId }));
      const vars = { first_name: cl.firstName, staff: opening.staffName.split(" ")[0]!, when, service: service.name, link };
      const text = renderInvite(business.fillMessage, vars);
      const marketing = s.reason !== "waitlist";
      const id = crypto.randomUUID();
      if (s.channel === "sms") {
        const phone = normalizePhone(cl.phone);
        if (!phone) continue;
        notes.push({ id, businessId: business.id, clientId: cl.id, locationId: opening.locationId, channel: "sms", template: "fill_invite", recipient: phone, body: await smsWithStopNotice(tx, cl, `${business.name}: ${text}`, marketing), marketing, scheduledAt });
      } else {
        const t = marketingEmail(brand, { subject: `${vars.staff} has an opening ${when}`, text: text.replace(link, "").trim(), ctaLabel: "Book this time", ctaUrl: link, unsubscribeUrl: unsubscribeUrl(business, cl.id) });
        notes.push({ id, businessId: business.id, clientId: cl.id, locationId: opening.locationId, channel: "email", template: "fill_invite", recipient: cl.email!, subject: t.subject, body: t.html, marketing, scheduledAt });
      }
      invites.push({ businessId: business.id, clientId: cl.id, staffId: opening.staffId, serviceId: s.serviceId, locationId: opening.locationId, slotStart: opening.start, reason: s.reason, channel: s.channel!, notificationId: id, sentByUserId: actorUserId });
    }
    if (!notes.length) return [];
    await tx.insert(schema.notifications).values(notes);
    await tx.insert(schema.fillInvites).values(invites);
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "fill.invite", entity: "staff", entityId: opening.staffId, diff: JSON.stringify({ slot: opening.start.toISOString(), invited: invites.length, auto: !actorUserId }) });
    return notes.map((n) => n.id!);
  });
  if (ids.length && opts.deliverNow !== false) after(() => deliverMany(business.id, ids).catch((e) => console.error("[fill] delivery failed", (e as Error).message)));
  return { sent: ids.length, skipped };
}

/** Record bookings made by invited clients soon after their invitation (exact slot or another time). Idempotent. */
export async function recordFillBookings(businessId: string): Promise<number> {
  const rows = await withTenant(businessId, (tx) =>
    tx.execute(sql`
      update fill_invites fi set booked_appointment_id = x.appt_id, booked_at = x.created_at, booked_exact_slot = x.exact
      from (
        select distinct on (i.id) i.id as invite_id, a.id as appt_id, a.created_at, (ai.staff_id = i.staff_id and ai.start_at = i.slot_start) as exact
        from fill_invites i
        join appointments a on a.client_id = i.client_id and a.created_at > i.created_at and a.created_at <= i.created_at + ${FILL_ATTRIBUTION_DAYS} * interval '1 day' and a.status not in ('cancelled')
        join appointment_items ai on ai.appointment_id = a.id and ai.sort_order = 0
        where i.booked_appointment_id is null and i.created_at > now() - interval '30 days'
        order by i.id, exact desc, a.created_at
      ) x
      where fi.id = x.invite_id
      returning fi.id
    `),
  );
  return (rows as unknown as unknown[]).length;
}

/** The last 30 days: invitations, bookings they brought, and the booked value. */
export async function fillStats(business: Business, now = new Date()) {
  await recordFillBookings(business.id);
  return withTenant(business.id, async (tx) => {
    const since = new Date(now.getTime() - 30 * DAY);
    const [row] = await tx
      .select({
        invites: sql<number>`count(*)`,
        booked: sql<number>`count(*) filter (where ${schema.fillInvites.bookedAppointmentId} is not null)`,
        exact: sql<number>`count(*) filter (where ${schema.fillInvites.bookedExactSlot})`,
      })
      .from(schema.fillInvites)
      .where(gte(schema.fillInvites.createdAt, since));
    const [value] = await tx
      .select({ cents: sql<number>`coalesce(sum(${schema.appointmentItems.priceCents}), 0)` })
      .from(schema.appointmentItems)
      .where(sql`${schema.appointmentItems.appointmentId} in (select booked_appointment_id from fill_invites where created_at >= ${since.toISOString()}::timestamptz and booked_appointment_id is not null) and ${schema.appointmentItems.status} <> 'cancelled'`);
    const recent = await tx
      .select({
        id: schema.fillInvites.id,
        slotStart: schema.fillInvites.slotStart,
        reason: schema.fillInvites.reason,
        channel: schema.fillInvites.channel,
        createdAt: schema.fillInvites.createdAt,
        auto: sql<boolean>`${schema.fillInvites.sentByUserId} is null`,
        bookedAppointmentId: schema.fillInvites.bookedAppointmentId,
        exact: schema.fillInvites.bookedExactSlot,
        clientId: schema.fillInvites.clientId,
        firstName: schema.clients.firstName,
        lastName: schema.clients.lastName,
        staffName: schema.staff.displayName,
        status: schema.notifications.status,
        error: schema.notifications.error,
      })
      .from(schema.fillInvites)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.fillInvites.clientId))
      .leftJoin(schema.staff, eq(schema.staff.id, schema.fillInvites.staffId))
      .leftJoin(schema.notifications, eq(schema.notifications.id, schema.fillInvites.notificationId))
      .where(gte(schema.fillInvites.createdAt, since))
      .orderBy(desc(schema.fillInvites.createdAt))
      .limit(100);
    return { invites: Number(row?.invites ?? 0), booked: Number(row?.booked ?? 0), exact: Number(row?.exact ?? 0), bookedCents: Number(value?.cents ?? 0), recent };
  });
}

/**
 * The automatic mode, from the 5-minute jobs run: once a day per business that turned it on, from its chosen hour (and before quiet
 * hours start), invite the best-suited clients to each opening, earliest first, within the per-slot and daily limits.
 */
export async function runAutoFill(now = new Date()): Promise<{ businesses: number; sent: number; failed: number }> {
  const on = await db.query.businesses.findMany({ where: eq(schema.businesses.fillAutoEnabled, true) });
  let sent = 0;
  let failed = 0;
  let ran = 0;
  for (const business of on) {
    if (business.suspendedAt) continue;
    try {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, hour: "numeric", hour12: false }).format(now)) % 24;
      if (hour < business.fillAutoHour || hour >= 19) continue;
      const today = instantToISODate(now, business.timezone);
      // Claim today's run: exactly one caller gets the row back, however many runs overlap.
      const claimed = await db
        .update(schema.businesses)
        .set({ fillAutoRanOn: today })
        .where(and(eq(schema.businesses.id, business.id), sql`${schema.businesses.fillAutoRanOn} is distinct from ${today}`))
        .returning({ id: schema.businesses.id });
      if (!claimed.length) continue;
      ran++;
      const { openings, sentToday: already } = await findOpenings(business, now);
      let left = business.fillMaxPerDay - already;
      for (const o of openings) {
        if (left <= 0) break;
        const ids = o.suggestions.filter((s) => s.channel).slice(0, Math.min(o.remaining, left)).map((s) => s.clientId);
        if (!ids.length) continue;
        try {
          const r = await sendFillInvites(business, { staffId: o.staffId, start: o.start, locationId: o.locationId, clientIds: ids }, null, now, { deliverNow: false });
          sent += r.sent;
          left -= r.sent;
        } catch (e) {
          // The opening went, or nobody fits it any more: carry on with the next one.
          if (!(e instanceof FillError)) throw e;
        }
      }
    } catch (e) {
      failed++;
      await reportError("fill-books: automatic run failed", e, { businessId: business.id });
    }
  }
  return { businesses: ran, sent, failed };
}

