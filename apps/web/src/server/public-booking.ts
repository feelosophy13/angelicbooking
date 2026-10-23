import { listCancellationReasons } from "@/server/cancellation-reasons";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { buildBookingSegments, canClientCancel, instantToISODate, isWithinBookingWindow, normalizePhone, onlineBookingWindow, zonedToInstant } from "@angelic/core";
import { getStaffAvailability, getStaffAvailabilityForDates, staffForService, timingFor } from "./availability";
import { bookAppointment, BookingError, rescheduleAppointment, rescheduleService, setAppointmentStatus } from "./booking";
import { appointmentForIntent, refundDeposit, refundOrphanIntent, type VerifiedIntent } from "./online-payments";
import { findReferrer } from "./loyalty";
import { validatePromo, PromoError } from "./promos";
import { after } from "next/server";
import { appointmentContext, notifyAppointment, queueOneOff } from "@/lib/notify";
import { triggerWorkflows } from "@/server/workflows";
import { staffAlertEmail } from "@/lib/notify/templates";
import { appUrl } from "@/lib/stripe";
import { businessAccess, publishBlockedReason } from "./access";
import { formatMoney, shiftISODate } from "@/lib/utils";
import { overridesForService, priceForStaff, termsOf } from "./stylist-pricing";
import { sameClientName } from "@/lib/client-match";
import { policySnapshot } from "@/lib/policy-text";
import { isSmsSuppressed, smsMarketingConsent } from "./consent";
import { paymentContextFor, serviceOfferedAt, servicesHiddenAt, staffIdsAt, tzFor } from "./locations";
import { addClientPhotos, clientPhotoCounts } from "./visit-photos";
import type { DroppedPhoto } from "@/lib/booking-photos";
import { markHelcimCheckoutUsed, refundUnusedCheckout } from "./helcim/online";
import { addonsForService, addonTerms } from "./addons";

export type PublicBusiness = typeof schema.businesses.$inferSelect;

/** Unscoped lookup for the public page. Returns null if booking is off. */
export async function getPublicBusiness(slug: string): Promise<PublicBusiness | null> {
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!b || !b.onlineBookingEnabled || b.suspendedAt) return null;
  // Closed too: trial over with no subscription, or the owner has not verified their email yet (new businesses only).
  if ((await businessAccess(b)).state === "expired") return null;
  if (await publishBlockedReason(b)) return null;
  return b;
}

/**
 * The business behind a link in a message (unsubscribe, and other links that must keep working): it only has to exist and not be
 * suspended. Unlike getPublicBusiness, turning online booking off or an expired trial doesn't break it.
 */
export async function getBusinessForLinks(slug: string): Promise<PublicBusiness | null> {
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  return b && !b.suspendedAt ? b : null;
}

/** Average rating and count of submitted reviews, for the booking page header. */
export async function getPublicRating(businessId: string): Promise<{ average: number; count: number }> {
  const [agg] = await withTenant(businessId, (tx) =>
    tx.select({ n: sql<number>`count(*)`, avg: sql<number>`coalesce(avg(${schema.reviews.rating}), 0)` }).from(schema.reviews).where(sql`${schema.reviews.submittedAt} is not null and ${schema.reviews.rating} is not null`),
  );
  return { average: Number(agg?.avg ?? 0), count: Number(agg?.n ?? 0) };
}

export async function getPublicLocations(businessId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.isDefault), asc(schema.locations.name)));
}

export async function getPublicMenu(businessId: string, locationId?: string | null) {
  return withTenant(businessId, async (tx) => {
    const [servicesAll, categories, staffAll, hidden, at] = await Promise.all([
      tx
        .select()
        .from(schema.services)
        .where(and(eq(schema.services.active, true), eq(schema.services.bookableOnline, true)))
        .orderBy(asc(schema.services.sortOrder), asc(schema.services.name)),
      tx.select().from(schema.serviceCategories).orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name)),
      tx
        .select({ id: schema.staff.id, displayName: schema.staff.displayName, color: schema.staff.color, photoUrl: schema.staff.photoUrl, bio: schema.staff.bio, position: schema.staff.position, workPhotoUrls: schema.staff.workPhotoUrls })
        .from(schema.staff)
        .where(and(eq(schema.staff.active, true), eq(schema.staff.bookableOnline, true), eq(schema.staff.takesAppointments, true)))
        .orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)),
      servicesHiddenAt(tx, locationId),
      staffIdsAt(tx, locationId),
    ]);
    // At a chosen location: only services offered there and providers who work there on some day.
    const services = servicesAll.filter((s) => !hidden.has(s.id));
    const staff = at ? staffAll.filter((s) => at.has(s.id)) : staffAll;
    return { services, categories, staff };
  });
}

/**
 * Slots for a service on a date. staffId "any" merges every eligible provider;
 * each slot carries the staff member who would take it (first available by sort order).
 */
/** The service if it is bookable online (and offered at the location), else null. */
async function publicService(business: PublicBusiness, serviceId: string, locationId?: string | null) {
  return withTenant(business.id, async (tx) => {
    const svc = await tx.query.services.findFirst({ where: and(eq(schema.services.id, serviceId), eq(schema.services.active, true), eq(schema.services.bookableOnline, true)) });
    return svc && (await serviceOfferedAt(tx, svc.id, locationId)) ? svc : null;
  });
}

/** Providers a client may pick for a service online (perform it, bookable online, work at the location). */
export async function publicProvidersFor(business: PublicBusiness, serviceId: string, locationId?: string | null) {
  return (await staffForService(business.id, serviceId, locationId)).filter((s) => s.bookableOnline);
}

export async function getPublicSlots(business: PublicBusiness, serviceId: string, staffId: string | "any", date: string, now = new Date(), locationId?: string | null) {
  const service = await publicService(business, serviceId, locationId);
  if (!service) return [];
  const window = onlineBookingWindow(now, business);
  const eligible = await publicProvidersFor(business, serviceId, locationId);
  const chosen = staffId === "any" ? eligible : eligible.filter((s) => s.id === staffId);
  const overrides = await withTenant(business.id, (tx) => overridesForService(tx, serviceId));
  // One entry per start time. `staffId` is the provider booked if she takes it as is; `free` is everyone open then.
  const out = new Map<number, { at: Date; staffId: string; staffName: string; free: string[] }>();
  for (const s of chosen) {
    const slots = await getStaffAvailability({
      businessId: business.id,
      timeZone: business.timezone,
      slotIntervalMin: business.slotIntervalMin,
      staffId: s.id,
      date,
      // Each stylist's own length, so a slot is only offered when their whole appointment fits.
      service: timingFor({ ...service, durationMin: overrides.get(s.id)?.duration ?? service.durationMin }),
      notBefore: window.notBefore,
      locationId,
    });
    for (const at of slots) {
      if (at > window.notAfter) continue;
      const seen = out.get(at.getTime());
      if (seen) seen.free.push(s.id);
      else out.set(at.getTime(), { at, staffId: s.id, staffName: s.displayName, free: [s.id] });
    }
  }
  const list = [...out.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  // "Any available provider": which of the free people the visit goes to, by the salon's rule.
  if (staffId === "any" && business.anyProviderMode !== "choose" && business.anyProviderMode !== "first" && list.some((s) => s.free.length > 1)) {
    const price = (id: string) => overrides.get(id)?.price ?? service.priceCents;
    const load = business.anyProviderMode === "fewest_bookings" ? await bookingsOn(business, chosen.map((s) => s.id), date, locationId) : null;
    const order = new Map(chosen.map((s, i) => [s.id, i]));
    const names = new Map(chosen.map((s) => [s.id, s.displayName]));
    for (const s of list) {
      if (s.free.length < 2) continue;
      const best = [...s.free].sort((a, b) => (load ? (load.get(a) ?? 0) - (load.get(b) ?? 0) : price(a) - price(b)) || price(a) - price(b) || order.get(a)! - order.get(b)!)[0]!;
      s.staffId = best;
      s.staffName = names.get(best) ?? s.staffName;
    }
  }
  return list;
}

/** Appointments each provider already has on a day (the lighter day gets the next "Any available" visit). */
async function bookingsOn(business: PublicBusiness, staffIds: string[], date: string, locationId?: string | null): Promise<Map<string, number>> {
  const loc = locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) })) : null;
  const tz = tzFor(business, loc ?? null);
  const from = zonedToInstant(date, "00:00", tz);
  const to = zonedToInstant(shiftISODate(date, 1), "00:00", tz);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ staffId: schema.appointmentItems.staffId, n: sql<number>`count(*)` })
      .from(schema.appointmentItems)
      .where(and(inArray(schema.appointmentItems.staffId, staffIds), gte(schema.appointmentItems.startAt, from), lt(schema.appointmentItems.startAt, to), sql`${schema.appointmentItems.status} not in ('cancelled','no_show')`, sql`${schema.appointmentItems.serviceName} not like '% (finish)'`))
      .groupBy(schema.appointmentItems.staffId),
  );
  return new Map(rows.map((r) => [r.staffId, Number(r.n)]));
}

/**
 * Which dates in [from, from+days) have at least one opening. One set of
 * queries per provider for the whole range (not per day), so a month costs
 * about the same as a single day did.
 */
export async function getAvailableDates(business: PublicBusiness, serviceId: string, staffId: string | "any", from: string, days: number, locationId?: string | null) {
  if (days <= 0) return [];
  const service = await publicService(business, serviceId, locationId);
  if (!service) return [];
  const window = onlineBookingWindow(new Date(), business);
  const eligible = await publicProvidersFor(business, serviceId, locationId);
  const chosen = staffId === "any" ? eligible : eligible.filter((s) => s.id === staffId);
  const dates = Array.from({ length: days }, (_, i) => shiftISODate(from, i));
  const overrides = await withTenant(business.id, (tx) => overridesForService(tx, serviceId));
  const open = new Set<string>();
  for (const s of chosen) {
    const remaining = dates.filter((d) => !open.has(d));
    if (!remaining.length) break;
    const byDate = await getStaffAvailabilityForDates({
      businessId: business.id,
      timeZone: business.timezone,
      slotIntervalMin: business.slotIntervalMin,
      staffId: s.id,
      dates: remaining,
      service: timingFor({ ...service, durationMin: overrides.get(s.id)?.duration ?? service.durationMin }),
      notBefore: window.notBefore,
      locationId,
    });
    for (const [d, slots] of byDate) if (slots.some((at) => at <= window.notAfter)) open.add(d);
  }
  return dates.filter((d) => open.has(d));
}

/** Average rating and review count per provider, from submitted reviews. */
export async function providerRatings(businessId: string): Promise<Map<string, { average: number; count: number }>> {
  const rows = await withTenant(businessId, (tx) =>
    tx
      .select({ staffId: schema.reviews.staffId, n: sql<number>`count(*)`, avg: sql<number>`avg(${schema.reviews.rating})` })
      .from(schema.reviews)
      .where(sql`${schema.reviews.submittedAt} is not null and ${schema.reviews.rating} is not null and ${schema.reviews.staffId} is not null`)
      .groupBy(schema.reviews.staffId),
  );
  return new Map(rows.map((r) => [r.staffId!, { average: Number(r.avg), count: Number(r.n) }]));
}

/** The soonest bookable start for each provider (null when nothing opens in the next three weeks). */
export async function nextOpenings(business: PublicBusiness, serviceId: string, staffIds: string[], locationId?: string | null): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>();
  const service = await publicService(business, serviceId, locationId);
  if (!service || !staffIds.length) return out;
  const window = onlineBookingWindow(new Date(), business);
  const loc = locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) })) : null;
  const from = instantToISODate(new Date(), tzFor(business, loc ?? null));
  const dates = Array.from({ length: 21 }, (_, i) => shiftISODate(from, i));
  const overrides = await withTenant(business.id, (tx) => overridesForService(tx, serviceId));
  await Promise.all(
    staffIds.map(async (id) => {
      const byDate = await getStaffAvailabilityForDates({
        businessId: business.id,
        timeZone: business.timezone,
        slotIntervalMin: business.slotIntervalMin,
        staffId: id,
        dates,
        service: timingFor({ ...service, durationMin: overrides.get(id)?.duration ?? service.durationMin }),
        notBefore: window.notBefore,
        locationId,
      });
      let best: Date | null = null;
      for (const slots of byDate.values()) for (const at of slots) if (at <= window.notAfter && (!best || at < best)) best = at;
      out.set(id, best);
    }),
  );
  return out;
}

/** Who this signed-in client last saw for the service, if that person can still be booked for it. */
export async function lastProviderFor(businessId: string, clientId: string, serviceId: string): Promise<{ staffId: string; at: Date } | null> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select({ staffId: schema.appointmentItems.staffId, at: schema.appointmentItems.startAt })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointmentItems.serviceId, serviceId), lt(schema.appointmentItems.startAt, new Date()), sql`${schema.appointmentItems.status} not in ('cancelled','no_show')`))
      .orderBy(sql`${schema.appointmentItems.startAt} desc`)
      .limit(1),
  );
  return row ?? null;
}

export interface OnlineBookingInput {
  /** The client's address, saved with their acceptance of the cancellation policy. */
  ip?: string | null;
  serviceId: string;
  staffId: string;
  startAt: Date;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Client ticked the SMS consent box on the public form. */
  smsConsent?: boolean;
  /** The separate "also text me offers" box: written consent to marketing texts. */
  smsMarketingConsent?: boolean;
  /** Joining a class: the session id (staffId/startAt then come from the session). */
  classSessionId?: string | null;
  /** Friend's referral code typed on the booking form (new clients only). */
  referralCode?: string | null;
  /** Birthday from the booking form, YYYY-MM-DD. */
  birthday?: string | null;
  /** How the client proved who they are (booking code by text or email, or a signed-in session); null when not verified. */
  verifiedVia?: "session" | "sms" | "email" | null;
  /** The business asks for a booking code: marketing-text consent then counts only from a phone proven by code. */
  verificationOn?: boolean;
  /** Promo code typed on the booking form; validated against the service. */
  promoCode?: string | null;
  /** Location chosen on the booking page (businesses with several sites). */
  locationId?: string | null;
  /** The price in cents the page showed for this stylist, to catch a price that changed while the form was open. */
  quotedPriceCents?: number;
  /** Further services for the same visit and provider, in order, each starting when the one before ends. */
  extraServiceIds?: string[] | null;
  /** Pictures the client attached (inspiration, a reference, their current lashes); up to five, ignored when the business turned them off. */
  photos?: File[] | null;
}

export type BookingPhotosResult = { stored: number; dropped: DroppedPhoto[] };

/** The signed-in client for this business, if there is a request with a client session (never throws outside a request). */
async function signedInClientId(businessId: string): Promise<string | null> {
  try {
    const { getClientSessionId } = await import("@/lib/client-session");
    return await getClientSessionId(businessId);
  } catch {
    return null;
  }
}

/**
 * The client for a public booking, form or order: the signed-in client when there is one; else an existing client with the same
 * phone or email AND the same name; else a new client. A same-contact, different-name visitor gets their own record (staff can merge
 * real duplicates) rather than being filed under, and seeing details of, someone else.
 */
export async function findOrCreateClient(businessId: string, input: OnlineBookingInput) {
  let created: string | null = null;
  const signedIn = await signedInClientId(businessId);
  const clientId = await withTenant(businessId, async (tx) => {
    if (signedIn) {
      const me = await tx.query.clients.findFirst({ where: eq(schema.clients.id, signedIn), columns: { id: true } });
      if (me) return me.id;
    }
    const phone = normalizePhone(input.phone) ?? input.phone;
    const conds = [];
    if (phone) conds.push(eq(schema.clients.phone, phone));
    if (input.email) conds.push(sql`lower(${schema.clients.email}) = ${input.email.toLowerCase()}`);
    const candidates = conds.length ? await tx.query.clients.findMany({ where: or(...conds), orderBy: [asc(schema.clients.createdAt), asc(schema.clients.id)], limit: 25 }) : [];
    // A phone or email proven by a booking code belongs to whoever has it on file, whatever name was typed ("Jen" vs "Jennifer"); an
    // unproven one only counts together with the same name, so a stranger's booking never lands on someone else's record.
    const email = input.email?.toLowerCase() ?? null;
    const existing =
      input.verifiedVia === "sms" ? candidates.find((c) => c.phone === phone) ?? candidates.find((c) => sameClientName(c, input))
      : input.verifiedVia === "email" ? candidates.find((c) => c.email?.toLowerCase() === email) ?? candidates.find((c) => sameClientName(c, input))
      : candidates.find((c) => sameClientName(c, input));
    // A number that replied STOP stays off texts until it texts START, whatever is ticked here.
    const stopped = await isSmsSuppressed(tx, phone);
    // Marketing texts need consent from the number's owner: with booking codes on, only a phone proven by code (or a signed-in client) counts.
    const consentCounts = !input.verificationOn || input.verifiedVia === "sms" || input.verifiedVia === "session";
    const marketing = input.smsMarketingConsent && !stopped && consentCounts ? smsMarketingConsent(true, input.verifiedVia === "sms" ? "online booking form (phone verified by code)" : "online booking form") : {};
    if (existing) {
      // Fill in gaps without overwriting what the business already has.
      await tx
        .update(schema.clients)
        .set({ email: existing.email ?? input.email, phone: existing.phone ?? phone, ...(input.smsConsent && !stopped ? { smsOptIn: true } : {}), ...marketing })
        .where(eq(schema.clients.id, existing.id));
      return existing.id;
    }
    const referrer = await findReferrer(tx, input.referralCode);
    const [row] = await tx
      .insert(schema.clients)
      .values({ businessId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone, smsOptIn: input.smsConsent === true && !stopped, ...marketing, referredByClientId: referrer?.id ?? null, birthday: input.birthday ?? null })
      .returning({ id: schema.clients.id });
    created = row!.id;
    return row!.id;
  });
  // "New client" workflows start once the row is committed (after the response is sent).
  if (created) {
    const id = created;
    after(async () => {
      const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
      if (business) await triggerWorkflows(business, "client_created", { clientId: id, dedupeKey: id, facts: { firstVisit: true, clientTags: [] }, context: { reason: "New client (online)" } }).catch((e) => console.error("[workflows] client_created failed", (e as Error).message));
    });
  }
  return clientId;
}

/** Checks a public booking can still be made at `startAt` (window + live availability). */
export async function assertSlotOpen(business: PublicBusiness, serviceId: string, staffId: string, startAt: Date, now = new Date(), locationId?: string | null) {
  if (!isWithinBookingWindow(startAt, now, business)) throw new BookingError("That time can no longer be booked online.");
  // Re-validate the slot against live availability so stale pages can't book into a taken time.
  // The date is taken in the location's clock, the same way the page listed the slot.
  const loc = locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, locationId) })) : null;
  const slots = await getPublicSlots(business, serviceId, staffId, isoDateIn(startAt, tzFor(business, loc ?? null)), now, locationId);
  if (!slots.some((s) => s.at.getTime() === startAt.getTime())) throw new BookingError("That time was just taken. Please pick another.");
}

/** The price shown on the page must still be what this stylist charges. Classes are priced per seat and not checked. */
export async function assertQuotedPrice(business: PublicBusiness, input: { serviceId: string; staffId: string; quotedPriceCents?: number; classSessionId?: string | null }) {
  if (input.quotedPriceCents === undefined || input.classSessionId) return;
  const current = await priceForStaff(business.id, input.serviceId, input.staffId);
  if (current !== null && current !== input.quotedPriceCents) {
    throw new BookingError(`The price for this appointment is now ${formatMoney(current, business.currency)}, not ${formatMoney(input.quotedPriceCents, business.currency)}. Please go back one step and check it.`);
  }
}


export interface PlannedExtra {
  serviceId: string;
  name: string;
  startAt: Date;
  endAt: Date;
  priceCents: number;
  durationMin: number;
  /** Suggested with the first service: booked at its add-on terms (price and time) with the "(add-on)" label. */
  addon: { priceCents: number; durationMin: number | null; regularPriceCents: number } | null;
}

/**
 * Start times that day when the whole visit fits with this provider: the first service and every added one back to back. Offered when
 * an added service doesn't fit after the time the client picked (at most `limit` times, earliest first).
 */
export async function timesThatFitVisit(business: PublicBusiness, input: { serviceId: string; staffId: string; date: string; extraServiceIds: string[]; locationId?: string | null }, now = new Date(), limit = 6): Promise<Date[]> {
  const slots = (await getPublicSlots(business, input.serviceId, input.staffId, input.date, now, input.locationId)).filter((s) => s.free.includes(input.staffId));
  const out: Date[] = [];
  for (const s of slots.slice(0, 48)) {
    try {
      await planExtras(business, { serviceId: input.serviceId, staffId: input.staffId, startAt: s.at, extraServiceIds: input.extraServiceIds, locationId: input.locationId }, now);
      out.push(s.at);
      if (out.length >= limit) break;
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
    }
  }
  return out;
}

/**
 * Further services added to one visit: same provider, back to back after the first. Each must be bookable online,
 * performed by that provider, and open at the moment the one before it ends. Throws a BookingError the client can read.
 */
export async function planExtras(
  business: PublicBusiness,
  input: { serviceId: string; staffId: string; startAt: Date; extraServiceIds?: string[] | null; locationId?: string | null },
  now = new Date(),
): Promise<PlannedExtra[]> {
  const ids = [...new Set(input.extraServiceIds ?? [])].filter((id) => id && id !== input.serviceId).slice(0, 4);
  if (!ids.length) return [];
  const first = await publicService(business, input.serviceId, input.locationId);
  if (!first) throw new BookingError("That service is no longer available.");
  const loc = input.locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, input.locationId!) })) : null;
  const tz = tzFor(business, loc ?? null);
  const window = onlineBookingWindow(now, business);
  const endOf = (start: Date, timing: ReturnType<typeof timingFor>) => buildBookingSegments(start, timing).at(-1)!.end;
  const firstOv = (await withTenant(business.id, (tx) => overridesForService(tx, first.id))).get(input.staffId);
  const pairings = new Map((await withTenant(business.id, (tx) => addonsForService(tx, first.id))).map((p) => [p.addonServiceId, p]));
  let cursor = endOf(input.startAt, timingFor({ ...first, durationMin: firstOv?.duration ?? first.durationMin }));
  const out: PlannedExtra[] = [];
  for (const id of ids) {
    const svc = await publicService(business, id, input.locationId);
    if (!svc || svc.capacity > 1) throw new BookingError("One of the added services is no longer available.");
    if (!(await publicProvidersFor(business, id, input.locationId)).some((s) => s.id === input.staffId)) throw new BookingError(`This provider doesn't perform ${svc.name}.`);
    const ov = (await withTenant(business.id, (tx) => overridesForService(tx, id))).get(input.staffId);
    const usual = termsOf(svc, ov);
    const pairing = pairings.get(id);
    const add = pairing ? addonTerms(pairing, usual) : null;
    const terms = add ?? usual;
    // An add-on with its own time is one plain block (the same rule bookAppointment applies when it saves it).
    const timing = pairing?.durationMin != null ? timingFor({ durationMin: pairing.durationMin, gapMin: 0, finishMin: 0, bufferAfterMin: svc.bufferAfterMin }) : timingFor({ ...svc, durationMin: terms.durationMin });
    // A 5-minute grid, because the previous service can end between the salon's usual start times.
    const open = await getStaffAvailability({ businessId: business.id, timeZone: business.timezone, slotIntervalMin: 5, staffId: input.staffId, date: isoDateIn(cursor, tz), service: timing, notBefore: window.notBefore, locationId: input.locationId });
    if (cursor > window.notAfter || !open.some((at) => at.getTime() === cursor.getTime())) {
      throw new BookingError(`${svc.name} isn't open right after your first service. Remove it, or pick another time.`);
    }
    const startedAt = cursor;
    cursor = endOf(cursor, timing);
    out.push({ serviceId: id, name: svc.name, startAt: startedAt, endAt: cursor, priceCents: terms.priceCents, durationMin: terms.durationMin, addon: add && pairing ? { priceCents: add.priceCents, durationMin: pairing.durationMin, regularPriceCents: add.regularPriceCents } : null });
  }
  return out;
}

/**
 * A class seat booked online: the session is still on, is the service the deposit was worked out from (so a free service's id can't carry a
 * paid class's seat), matches the time and instructor shown, is inside the online booking window, and has room.
 */
export async function assertClassSeatOpen(business: PublicBusiness, input: { classSessionId: string; serviceId: string; staffId: string; startAt: Date }, now = new Date()) {
  const { getSession } = await import("./classes");
  const s = await getSession(business.id, input.classSessionId);
  if (!s || s.session.status !== "scheduled") throw new BookingError("That class is no longer scheduled.");
  if (s.session.serviceId !== input.serviceId || s.session.staffId !== input.staffId || s.session.startAt.getTime() !== input.startAt.getTime()) throw new BookingError("That class has changed. Please reload and pick it again.");
  if (!s.service?.bookableOnline || !s.service.active) throw new BookingError("That class can't be booked online.");
  if (!isWithinBookingWindow(input.startAt, now, business)) throw new BookingError("That class can no longer be booked online.");
  if (s.seatsLeft <= 0) throw new BookingError("This class is full.");
}

export async function createOnlineBooking(business: PublicBusiness, input: OnlineBookingInput, now = new Date(), paid?: VerifiedIntent) {
  if (input.classSessionId) {
    try {
      await assertClassSeatOpen(business, { classSessionId: input.classSessionId, serviceId: input.serviceId, staffId: input.staffId, startAt: input.startAt }, now);
    } catch (e) {
      await undoPayment(business, paid);
      throw e;
    }
  }
  if (!input.classSessionId) {
    try {
      await assertQuotedPrice(business, input);
      await assertSlotOpen(business, input.serviceId, input.staffId, input.startAt, now, input.locationId);
    } catch (e) {
      await undoPayment(business, paid);
      throw e;
    }
  }
  let extras: PlannedExtra[] = [];
  if (!input.classSessionId) {
    try {
      extras = await planExtras(business, input, now);
    } catch (e) {
      await undoPayment(business, paid);
      throw e;
    }
  }
  const clientId = paid?.meta.clientId ?? (await findOrCreateClient(business.id, input));
  let promoCodeId: string | null = null;
  if (input.promoCode) {
    try {
      promoCodeId = (await withTenant(business.id, (tx) => validatePromo(tx, input.promoCode!, { serviceIds: [input.serviceId] }))).id;
    } catch (e) {
      await undoPayment(business, paid);
      if (e instanceof PromoError) throw new BookingError(e.message);
      throw e;
    }
  }
  let appointmentId: string;
  try {
    ({ appointmentId } = await bookAppointment({
      businessId: business.id,
      clientId,
      serviceId: input.serviceId,
      staffId: input.staffId,
      startAt: input.startAt,
      notes: input.notes,
      createdByUserId: null, // self-service: the activity log records "client" as the actor
      source: "online",
      deposit: paid?.kind === "deposit" ? { paymentIntentId: paid.paymentIntentId, cents: paid.cents, surchargeCents: paid.surchargeCents, cardLabel: paid.cardLabel, accountId: paid.accountId, provider: paid.provider ?? "stripe", providerPaymentId: paid.providerPaymentId ?? null } : null,
      cardSetupIntentId: paid?.kind === "card" ? paid.setupIntentId : null,
      classSessionId: input.classSessionId ?? null,
      promoCodeId,
      locationId: input.locationId ?? null,
      extras: extras.map((x) => ({ serviceId: x.serviceId, startAt: x.startAt, addon: x.addon ? { priceCents: x.addon.priceCents, durationMin: x.addon.durationMin } : null })),
      // Booking online is agreeing to the cancellation policy shown on the form: keep exactly that text, when, and from where.
      policy: { text: policySnapshot(business), ip: input.ip ?? null },
    }));
  } catch (e) {
    await undoPayment(business, paid);
    throw e;
  }
  const token = await withTenant(business.id, async (tx) => (await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) }))!.manageToken);
  // A Helcim checkout's money is now this booking's: the sweep for paid-but-unbooked checkouts must leave it alone.
  if (paid?.provider === "helcim") await markHelcimCheckoutUsed(business.id, paid.kind === "deposit" ? paid.paymentIntentId : paid.setupIntentId);
  // The booking is made; the pictures come after it and can never undo it. Stored before the messages go out so they can mention them.
  const photos: BookingPhotosResult = business.clientPhotosOnBooking && input.photos?.length ? await addClientPhotos({ businessId: business.id, appointmentId, files: input.photos }) : { stored: 0, dropped: [] };
  await notifyAppointment(business, appointmentId, "confirmation");
  await alertBusiness(business, appointmentId, "booked");
  return { appointmentId, token, photos };
}

/** A deposit was charged but the booking could not be made: give the money back before surfacing the error. */
async function undoPayment(business: PublicBusiness, paid: VerifiedIntent | undefined) {
  if (paid?.kind !== "deposit") return;
  // A double submit: the twin request already booked with this deposit (that's often why this one failed). Keep the money.
  if (await appointmentForIntent(business.id, paid.paymentIntentId)) return;
  if (paid.provider === "helcim") {
    await refundUnusedCheckout(business, paid.paymentIntentId).catch((e) => console.error("[helcim] could not refund orphan deposit", paid.paymentIntentId, (e as Error).message));
    return;
  }
  const pay = await paymentContextFor(business, paid.meta.locationId || null);
  if (!pay.accountId) return;
  try {
    await refundOrphanIntent(pay.accountId, paid.paymentIntentId);
  } catch (e) {
    console.error("[online-payments] could not refund orphan deposit", paid.paymentIntentId, (e as Error).message);
  }
}

function isoDateIn(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return p; // en-CA gives YYYY-MM-DD
}

/** Everything the client's self-service page needs, by secret token. */
export async function getManagedAppointment(slug: string, token: string) {
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business || business.suspendedAt) return null;
  return withTenant(business.id, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.manageToken, token) });
    if (!appt) return null;
    const items = await tx
      .select({ id: schema.appointmentItems.id, name: schema.appointmentItems.serviceName, staffId: schema.appointmentItems.staffId, staffName: schema.staff.displayName, serviceId: schema.appointmentItems.serviceId, classSessionId: schema.appointmentItems.classSessionId, priceCents: schema.appointmentItems.priceCents, startAt: schema.appointmentItems.startAt, endAt: schema.appointmentItems.endAt, status: schema.appointmentItems.status })
      .from(schema.appointmentItems)
      .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .where(eq(schema.appointmentItems.appointmentId, appt.id))
      .orderBy(asc(schema.appointmentItems.startAt));
    const client = appt.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, appt.clientId) }) : null;
    const location = appt.locationId ? ((await tx.query.locations.findFirst({ where: eq(schema.locations.id, appt.locationId) })) ?? null) : null;
    const live = items.filter((i) => i.status !== "cancelled");
    const start = (live[0] ?? items[0])?.startAt ?? null;
    const clientPhotos = (await clientPhotoCounts(tx, [appt.id])).get(appt.id) ?? 0;
    return { business, appt, location, timeZone: tzFor(business, location), items, live, client, start, clientPhotos, canChange: !!start && appt.status !== "cancelled" && appt.status !== "completed" && appt.status !== "no_show" && canClientCancel(start, new Date(), business) };
  });
}

export async function cancelOnline(slug: string, token: string, reasonId?: string | null) {
  const m = await getManagedAppointment(slug, token);
  if (!m) throw new BookingError("Appointment not found.");
  if (!m.canChange) throw new BookingError(`Online cancellation closes ${m.business.cancelWindowHours} hours before the appointment. Please call ${m.business.phone ?? "the salon"}.`);
  // Optional: only a reason the salon offers to clients counts; anything else is ignored.
  const offered = reasonId ? (await listCancellationReasons(m.business.id)).find((r) => r.id === reasonId && r.clientVisible) : null;
  const changed = await setAppointmentStatus(m.business.id, m.appt.id, "cancelled", "client", "Cancelled online by client", offered?.id ?? null);
  if (!changed) return { refundFailed: false };
  // Inside the cancellation window the deposit goes back automatically (on the account that took it). If that fails the money is still
  // owed: the salon is told (activity log and email) and the client's page says it will be sorted out, rather than that it went back.
  const pay = await paymentContextFor(m.business, m.appt.locationId);
  let refundFailed = false;
  await refundDeposit({ businessId: m.business.id, accountId: pay.accountId, appointmentId: m.appt.id, actorUserId: "client", reason: "Cancelled online within policy" }).catch(async (e) => {
    refundFailed = true;
    console.error("[online-payments] deposit refund on cancel failed", m.appt.id, (e as Error).message);
    await withTenant(m.business.id, (tx) => tx.insert(schema.auditLog).values({ businessId: m.business.id, actorUserId: null, action: "deposit.refund_failed", entity: "appointment", entityId: m.appt.id, diff: JSON.stringify({ error: (e as Error).message }) }));
    if (m.business.email) {
      await queueOneOff(m.business.id, { channel: "email", template: "deposit_refund_failed", recipient: m.business.email, subject: "A deposit refund didn't go through", body: `<p>A client cancelled online and their deposit should have gone back automatically, but the refund failed: ${(e as Error).message}</p><p><a href="${appUrl(`/app/${m.business.slug}/appointments/${m.appt.id}`)}">Open the appointment</a> and use "Refund deposit".</p>` }).catch(() => undefined);
    }
  });
  await notifyAppointment(m.business, m.appt.id, "cancellation");
  await alertBusiness(m.business, m.appt.id, "cancelled");
  return { refundFailed };
}

/**
 * Client moves their own appointment. A single service can also change provider (`staffChoice`: a staff id,
 * "any", or omitted to keep the current one); a multi-service booking moves as a whole with the same providers.
 */
export async function rescheduleOnline(slug: string, token: string, newStartAt: Date, staffChoice?: string | null) {
  const m = await getManagedAppointment(slug, token);
  if (!m) throw new BookingError("Appointment not found.");
  if (!m.canChange) throw new BookingError(`Online changes close ${m.business.cancelWindowHours} hours before the appointment.`);
  if (m.live.some((i) => i.classSessionId)) throw new BookingError("Seats in a class move with the class. Cancel and book another session instead.");
  const first = m.live[0];
  if (!first?.serviceId) throw new BookingError("Please call to reschedule.");
  if (!isWithinBookingWindow(newStartAt, new Date(), m.business)) throw new BookingError("That time can't be booked online.");
  const single = new Set(m.live.map((i) => i.serviceId)).size === 1;
  const wanted = single && staffChoice ? staffChoice : first.staffId;
  const slots = await getPublicSlots(m.business, first.serviceId, wanted, isoDateIn(newStartAt, m.timeZone), new Date(), m.appt.locationId);
  const slot = slots.find((s) => s.at.getTime() === newStartAt.getTime());
  if (!slot) throw new BookingError("That time was just taken. Please pick another.");
  if (single) await rescheduleService({ businessId: m.business.id, itemId: first.id, newStartAt, newStaffId: slot.staffId, actorUserId: "client" });
  else await rescheduleAppointment({ businessId: m.business.id, appointmentId: m.appt.id, newStartAt, actorUserId: "client" });
  await notifyAppointment(m.business, m.appt.id, "rescheduled");
  await alertBusiness(m.business, m.appt.id, "rescheduled");
}

/** Open waitlist entries one client may hold at a time. */
export const WAITLIST_CAP = 5;

/**
 * Join the waitlist for a day. The service must be bookable online (and the stylist, if picked, must do it there), the day must be
 * inside the online booking window, and one client holds at most WAITLIST_CAP open entries; asking again for the same day is a no-op.
 */
export async function joinWaitlist(business: PublicBusiness, input: { serviceId: string; staffId: string | null; date: string; firstName: string; lastName: string; email: string | null; phone: string | null; notes: string | null; smsConsent?: boolean; locationId?: string | null }, now = new Date()) {
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) }));
  if (!service || !service.active || !service.bookableOnline) throw new BookingError("That service can't be booked online.");
  if (input.locationId && !(await withTenant(business.id, (tx) => serviceOfferedAt(tx, input.serviceId, input.locationId)))) throw new BookingError("That service isn't offered at this location.");
  if (input.staffId && !(await staffForService(business.id, input.serviceId, input.locationId)).some((s) => s.id === input.staffId)) throw new BookingError("That stylist doesn't offer this service.");
  const loc = input.locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, input.locationId!) })) : null;
  const tz = tzFor(business, loc ?? null);
  const w = onlineBookingWindow(now, business);
  if (input.date < instantToISODate(now, tz) || input.date > instantToISODate(w.notAfter, tz)) throw new BookingError("Pick a day inside the booking window.");
  const clientId = await findOrCreateClient(business.id, { ...input, startAt: now, staffId: input.staffId ?? "" });
  await withTenant(business.id, async (tx) => {
    const open = await tx.select({ serviceId: schema.waitlist.serviceId, date: schema.waitlist.date }).from(schema.waitlist).where(and(eq(schema.waitlist.clientId, clientId), eq(schema.waitlist.status, "open"), gte(schema.waitlist.date, instantToISODate(now, tz))));
    if (open.some((o) => o.serviceId === input.serviceId && o.date === input.date)) return;
    if (open.length >= WAITLIST_CAP) throw new BookingError(`You're already on the waitlist for ${WAITLIST_CAP} days. We'll be in touch.`);
    await tx.insert(schema.waitlist).values({ businessId: business.id, clientId, serviceId: input.serviceId, staffId: input.staffId, locationId: input.locationId ?? null, date: input.date, notes: input.notes });
  });
}

export async function listWaitlist(businessId: string, timeZone: string) {
  const today = instantToISODate(new Date(), timeZone);
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.waitlist.id, date: schema.waitlist.date, notes: schema.waitlist.notes, status: schema.waitlist.status, createdAt: schema.waitlist.createdAt, clientFirst: schema.clients.firstName, clientLast: schema.clients.lastName, clientPhone: schema.clients.phone, clientId: schema.clients.id, serviceName: schema.services.name, serviceId: schema.services.id, staffName: schema.staff.displayName, locationId: schema.waitlist.locationId, locationName: schema.locations.name })
      .from(schema.waitlist)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.waitlist.clientId))
      .leftJoin(schema.services, eq(schema.services.id, schema.waitlist.serviceId))
      .leftJoin(schema.staff, eq(schema.staff.id, schema.waitlist.staffId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.waitlist.locationId))
      .where(and(eq(schema.waitlist.status, "open"), gte(schema.waitlist.date, today)))
      .orderBy(asc(schema.waitlist.date), asc(schema.waitlist.createdAt)),
  );
}

export async function setWaitlistStatus(businessId: string, id: string, status: "booked" | "closed") {
  await withTenant(businessId, (tx) => tx.update(schema.waitlist).set({ status }).where(eq(schema.waitlist.id, id)));
}

// keep imports used
void isNull; void lt; void inArray; void zonedToInstant;

/** Email the business when a client books/cancels/reschedules online (goes to the business profile email). */
async function alertBusiness(business: PublicBusiness, appointmentId: string, kind: "booked" | "cancelled" | "rescheduled") {
  if (!business.email) return;
  const built = await withTenant(business.id, (tx) => appointmentContext(tx, business, appointmentId));
  if (!built) return;
  const clientName = built.client ? `${built.client.firstName} ${built.client.lastName ?? ""}`.trim() : "A client";
  const t = staffAlertEmail(built.ctx, kind, clientName, appUrl(`/app/${business.slug}/appointments/${appointmentId}`));
  await queueOneOff(business.id, { channel: "email", template: `staff_${kind}`, recipient: business.email, subject: t.subject, body: t.html });
}
