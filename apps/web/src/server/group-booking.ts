/**
 * Booking for more than one person online ("Book for me and others"): the client books their own visit and adds up to MAX_GUESTS guests,
 * each with their own service and provider, starting together with the client or right after the person before them. Every person gets
 * their own appointment (their own client record, history and forms); the appointments share a group id (the lead's appointment id) so
 * staff see them side by side and can check them out together. Deposits are worked out per person and taken in one charge; each
 * appointment holds its own share, so cancelling one person gives back only their part.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { buildBookingSegments, normalizePhone, onlineBookingWindow } from "@angelic/core";
import { getStaffAvailability, timingFor } from "./availability";
import { bookAppointment, BookingError } from "./booking";
import { onlinePaymentRequirement, type PaymentMode, type VerifiedIntent } from "./online-payments";
import { overridesForService, termsOf } from "./stylist-pricing";
import { tzFor, type PaymentContext } from "./locations";
import { alertBusiness, assertQuotedPrice, assertSlotOpen, findOrCreateClient, signedInClientId, isoDateIn, planExtras, publicProvidersFor, publicService, undoPayment, type OnlineBookingInput, type PlannedExtra, type PublicBusiness, type BookingPhotosResult } from "./public-booking";
import { validatePromo, PromoError } from "./promos";
import { policySnapshot } from "@/lib/policy-text";
import { formatTime } from "@/lib/utils";
import { sameClientName } from "@/lib/client-match";
import { isSmsSuppressed } from "./consent";
import { linkClientsTx } from "./client-links";
import { markHelcimCheckoutUsed } from "./helcim/online";
import { addClientPhotos } from "./visit-photos";
import { afterAppointmentBooked, notifyAppointment } from "@/lib/notify";
import type { GuestChoice, GuestDetails } from "@/lib/group-guests";

export interface PlannedPerson {
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startAt: Date;
  /** When this person's whole visit (first service and any added ones) ends, cleanup included. */
  endAt: Date;
  /** This provider's price for the first service. */
  priceCents: number;
  extras: PlannedExtra[];
  /** First service plus everything added. */
  totalCents: number;
  /** The first service's deposit terms, for working out this person's share of the up-front payment. */
  deposit: { depositCents: number; depositType: string; depositPercent: number };
}

export interface GroupPlan {
  lead: PlannedPerson;
  guests: PlannedPerson[];
}

const endOf = (start: Date, timing: ReturnType<typeof timingFor>) => buildBookingSegments(start, timing).at(-1)!.end;
const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

/**
 * Plan everyone's appointment from the lead's choice: each guest starts with the lead or as the person before them finishes, with the
 * provider they picked (or the first one free for "any"), never on top of someone else in the same booking. Throws a BookingError naming
 * the guest that doesn't fit.
 */
export async function planGroup(
  business: PublicBusiness,
  input: { serviceId: string; staffId: string; startAt: Date; extraServiceIds?: string[] | null; locationId?: string | null; guests: GuestChoice[] },
  now = new Date(),
): Promise<GroupPlan> {
  const first = await publicService(business, input.serviceId, input.locationId);
  if (!first) throw new BookingError("That service is no longer available.");
  const loc = input.locationId ? await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, input.locationId!) })) : null;
  const tz = tzFor(business, loc ?? null);
  const window = onlineBookingWindow(now, business);
  const names = new Map((await withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff))).map((s) => [s.id, s.name]));
  const leadOv = (await withTenant(business.id, (tx) => overridesForService(tx, first.id))).get(input.staffId);
  const leadTerms = termsOf(first, leadOv);
  const leadExtras = await planExtras(business, { serviceId: first.id, staffId: input.staffId, startAt: input.startAt, extraServiceIds: input.extraServiceIds, locationId: input.locationId }, now);
  const leadEnd = leadExtras.at(-1)?.endAt ?? endOf(input.startAt, timingFor({ ...first, durationMin: leadTerms.durationMin }));
  const lead: PlannedPerson = { serviceId: first.id, serviceName: first.name, staffId: input.staffId, staffName: names.get(input.staffId) ?? "", startAt: input.startAt, endAt: leadEnd, priceCents: leadTerms.priceCents, extras: leadExtras, totalCents: leadTerms.priceCents + leadExtras.reduce((s, x) => s + x.priceCents, 0), deposit: first };
  // Time each provider is already given to someone in this booking (the calendar doesn't know about them yet).
  const claims: { staffId: string; start: Date; end: Date }[] = [{ staffId: lead.staffId, start: lead.startAt, end: lead.endAt }];
  const guests: PlannedPerson[] = [];
  let prevEnd = leadEnd;
  for (const [i, g] of input.guests.entries()) {
    const who = `Guest ${i + 1}`;
    const svc = await publicService(business, g.serviceId, input.locationId);
    if (!svc || svc.capacity > 1) throw new BookingError(`${who}'s service is no longer available. Pick another for them.`);
    const startAt = g.timing === "after" ? prevEnd : input.startAt;
    const providers = await publicProvidersFor(business, svc.id, input.locationId);
    const candidates = g.staffId === "any" ? providers : providers.filter((p) => p.id === g.staffId);
    if (!candidates.length) throw new BookingError(`${names.get(g.staffId) ?? "That provider"} doesn't do ${svc.name} online. Pick someone else for ${who.toLowerCase()}.`);
    const overrides = await withTenant(business.id, (tx) => overridesForService(tx, svc.id));
    let planned: PlannedPerson | null = null;
    let lastError: string | null = null;
    for (const c of candidates) {
      const terms = termsOf(svc, overrides.get(c.id));
      const timing = timingFor({ ...svc, durationMin: terms.durationMin });
      if (startAt > window.notAfter) break;
      // A 5-minute grid, because "right after" can fall between the salon's usual start times.
      const open = await getStaffAvailability({ businessId: business.id, timeZone: business.timezone, slotIntervalMin: 5, staffId: c.id, date: isoDateIn(startAt, tz), service: timing, notBefore: window.notBefore, locationId: input.locationId });
      if (!open.some((at) => at.getTime() === startAt.getTime())) {
        lastError = `${c.displayName} isn't free for ${who.toLowerCase()} at ${formatTime(startAt, tz)}.`;
        continue;
      }
      let extras: PlannedExtra[];
      try {
        extras = await planExtras(business, { serviceId: svc.id, staffId: c.id, startAt, extraServiceIds: g.extraServiceIds, locationId: input.locationId }, now);
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
        lastError = `${who}: ${e.message}`;
        continue;
      }
      const span = { start: startAt, end: extras.at(-1)?.endAt ?? endOf(startAt, timing) };
      if (claims.some((cl) => cl.staffId === c.id && overlaps(cl, span))) {
        lastError = `${c.displayName} is with someone else in your booking then. Pick "right after" or another provider for ${who.toLowerCase()}.`;
        continue;
      }
      planned = { serviceId: svc.id, serviceName: svc.name, staffId: c.id, staffName: c.displayName, startAt, endAt: span.end, priceCents: terms.priceCents, extras, totalCents: terms.priceCents + extras.reduce((s, x) => s + x.priceCents, 0), deposit: svc };
      break;
    }
    if (!planned) throw new BookingError(lastError ?? `${who} can't be booked at that time. Pick another time.`);
    claims.push({ staffId: planned.staffId, start: planned.startAt, end: planned.endAt });
    guests.push(planned);
    prevEnd = planned.endAt;
  }
  return { lead, guests };
}

/**
 * Start times that day when everyone fits: the lead's slots with the provider they chose, each tried with the whole group (at most
 * `limit`, earliest first).
 */
export async function groupTimesThatFit(business: PublicBusiness, input: { serviceId: string; staffId: string; extraServiceIds: string[]; locationId?: string | null; guests: GuestChoice[]; slots: Date[] }, now = new Date(), limit = 6): Promise<Date[]> {
  const out: Date[] = [];
  for (const at of input.slots.slice(0, 48)) {
    try {
      await planGroup(business, { ...input, startAt: at }, now);
      out.push(at);
      if (out.length >= limit) break;
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
    }
  }
  return out;
}

/**
 * What the group pays up front: each person's own requirement (their first service's deposit terms on their own visit price), added
 * up. Any deposit makes it a deposit (the card is saved with it); otherwise a card on file if anyone needs one. `shares` is each
 * person's part of the deposit, lead first.
 */
export function groupPaymentRequirement(business: PublicBusiness, pay: PaymentContext, plan: GroupPlan): { mode: PaymentMode; amountCents: number; full: boolean; shares: number[] } {
  const each = [plan.lead, ...plan.guests].map((p) => onlinePaymentRequirement(business, p.deposit, pay, p.totalCents));
  const shares = each.map((r) => (r.mode === "deposit" ? r.amountCents : 0));
  const amountCents = shares.reduce((s, x) => s + x, 0);
  if (amountCents > 0) return { mode: "deposit", amountCents, full: each.every((r) => r.mode === "deposit" && r.full), shares };
  if (each.some((r) => r.mode === "card")) return { mode: "card", amountCents: 0, full: false, shares };
  return { mode: "none", amountCents: 0, full: false, shares };
}

/** Binds a payment to the group it was worked out for, so guests can't be added after the deposit was taken. */
export function groupSignature(guests: GuestChoice[]): string {
  return guests.map((g) => `${g.serviceId}.${g.staffId}.${g.timing}.${g.extraServiceIds.join("_")}`).join("~").slice(0, 480);
}

/**
 * The client record for a guest. A family member the signed-in booker picked; else, with a phone or email, an existing client with that
 * contact and the same name; else a new client. Never the booker's own signed-in record, and never someone else's on a contact alone.
 */
async function guestClient(businessId: string, leadClientId: string, d: GuestDetails, signedIn: string | null): Promise<{ id: string; created: boolean }> {
  return withTenant(businessId, async (tx) => {
    if (d.familyClientId) {
      // The signed-in client's family (who may be booking for a child as the lead, with themselves as a guest).
      const owner = signedIn ?? leadClientId;
      const link = d.familyClientId === owner ? true : await tx.query.clientLinks.findFirst({ where: and(eq(schema.clientLinks.clientId, owner), eq(schema.clientLinks.linkedClientId, d.familyClientId)) });
      if (!signedIn || !link || d.familyClientId === leadClientId) throw new BookingError("That family member isn't linked to your account. Enter their name instead.");
      return { id: d.familyClientId, created: false };
    }
    const phone = normalizePhone(d.phone) ?? null;
    const email = d.email?.toLowerCase() ?? null;
    const conds = [];
    if (phone) conds.push(eq(schema.clients.phone, phone));
    if (email) conds.push(sql`lower(${schema.clients.email}) = ${email}`);
    if (conds.length) {
      const candidates = await tx.query.clients.findMany({ where: sql`(${sql.join(conds, sql` or `)})`, limit: 25 });
      const same = candidates.find((c) => c.id !== leadClientId && sameClientName(c, d));
      if (same) return { id: same.id, created: false };
    }
    const stopped = await isSmsSuppressed(tx, phone);
    // A guest's number was typed by someone else: appointment texts only, never marketing, and only if it isn't on STOP.
    const [row] = await tx.insert(schema.clients).values({ businessId, firstName: d.firstName, lastName: d.lastName, phone, email: d.email, smsOptIn: !!phone && !stopped }).returning({ id: schema.clients.id });
    return { id: row!.id, created: true };
  });
}

export interface GroupBookingInput extends OnlineBookingInput {
  guests: GuestChoice[];
  guestDetails: GuestDetails[];
}

/** One booking for the client and their guests. Mirrors createOnlineBooking; any failure removes what was made and refunds the deposit. */
export async function createGroupBooking(business: PublicBusiness, pay: PaymentContext, input: GroupBookingInput, now = new Date(), paid?: VerifiedIntent) {
  if (input.classSessionId) throw new BookingError("Guests can't be added to a class booking. Book each seat on its own.");
  if (input.guestDetails.length !== input.guests.length) throw new BookingError("Enter a name for each guest.");
  let plan: GroupPlan;
  try {
    await assertQuotedPrice(business, input);
    await assertSlotOpen(business, input.serviceId, input.staffId, input.startAt, now, input.locationId);
    plan = await planGroup(business, input, now);
  } catch (e) {
    await undoPayment(business, paid);
    throw e;
  }
  const req = groupPaymentRequirement(business, pay, plan);
  // The money must match what this group needs: a deposit taken for fewer people doesn't cover more.
  if ((req.mode === "none") !== !paid || (paid && paid.kind === "deposit" && (req.mode !== "deposit" || paid.cents !== req.amountCents))) {
    await undoPayment(business, paid);
    throw new BookingError(paid ? "The deposit for your group changed. It has been refunded; please book again." : "This booking needs a card. Please reload the page and try again.");
  }
  const leadClientId = paid?.meta.clientId ?? (await findOrCreateClient(business.id, input));
  const guestIds: { id: string; created: boolean }[] = [];
  let promoCodeId: string | null = null;
  try {
    const signedIn = await signedInClientId(business.id);
    for (const d of input.guestDetails) guestIds.push(await guestClient(business.id, leadClientId, d, signedIn));
    if (input.promoCode) promoCodeId = (await withTenant(business.id, (tx) => validatePromo(tx, input.promoCode!, { serviceIds: [input.serviceId] }))).id;
  } catch (e) {
    await undoPayment(business, paid);
    if (e instanceof PromoError) throw new BookingError(e.message);
    throw e;
  }
  // Family typed in by the booker (a child, a partner) is linked to them, but only for a record this booking made: an existing client
  // is never tied to a stranger on the strength of a name and a number.
  await withTenant(business.id, async (tx) => {
    for (const [i, g] of guestIds.entries()) {
      const rel = input.guestDetails[i]!.relation;
      if (g.created && rel !== "friend") await linkClientsTx(tx, business.id, leadClientId, g.id, rel);
    }
  });
  const share = (i: number) => req.shares[i] ?? 0;
  // A card fee charged with the group's deposit is split the same way as the deposit (the last share takes the rounding), so each
  // person's refund gives back their part of it.
  const surcharge = paid?.kind === "deposit" ? paid.surchargeCents ?? 0 : 0;
  const lastShare = req.shares.reduce((last, c, i) => (c > 0 ? i : last), -1);
  const feeOf = (i: number) => {
    if (!surcharge || share(i) <= 0 || req.amountCents <= 0) return 0;
    if (i !== lastShare) return Math.floor((surcharge * share(i)) / req.amountCents);
    return surcharge - req.shares.reduce((sum, c, j) => (j !== i && c > 0 ? sum + Math.floor((surcharge * c) / req.amountCents) : sum), 0);
  };
  const depositFor = (i: number) => (paid?.kind === "deposit" && share(i) > 0 ? { paymentIntentId: paid.paymentIntentId, cents: share(i), surchargeCents: feeOf(i), cardLabel: paid.cardLabel, accountId: paid.accountId, provider: paid.provider ?? "stripe", providerPaymentId: paid.providerPaymentId ?? null } : null);
  const policy = { text: policySnapshot(business), ip: input.ip ?? null };
  const made: string[] = [];
  const book = (p: PlannedPerson, clientId: string, i: number, groupId: string | null, notes: string | null) =>
    bookAppointment({
      businessId: business.id,
      clientId,
      serviceId: p.serviceId,
      staffId: p.staffId,
      startAt: p.startAt,
      notes,
      createdByUserId: null,
      source: "online",
      deposit: depositFor(i),
      cardSetupIntentId: paid?.kind === "card" ? paid.setupIntentId : null,
      promoCodeId: i === 0 ? promoCodeId : null,
      locationId: input.locationId ?? null,
      extras: p.extras.map((x) => ({ serviceId: x.serviceId, startAt: x.startAt, addon: x.addon ? { priceCents: x.addon.priceCents, durationMin: x.addon.durationMin } : null })),
      policy,
      groupId,
    });
  let leadId: string;
  try {
    leadId = (await book(plan.lead, leadClientId, 0, null, input.notes)).appointmentId;
    made.push(leadId);
    await withTenant(business.id, (tx) => tx.update(schema.appointments).set({ groupId: leadId }).where(eq(schema.appointments.id, leadId)));
    for (const [i, g] of plan.guests.entries()) made.push((await book(g, guestIds[i]!.id, i + 1, leadId, null)).appointmentId);
  } catch (e) {
    // Nothing was announced yet: take the half-made group off the calendar before giving the money back.
    if (made.length) await withTenant(business.id, (tx) => tx.delete(schema.appointments).where(inArray(schema.appointments.id, made)));
    await undoPayment(business, paid);
    throw e;
  }
  const token = await withTenant(business.id, async (tx) => (await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, leadId) }))!.manageToken);
  if (paid?.provider === "helcim") await markHelcimCheckoutUsed(business.id, paid.kind === "deposit" ? paid.paymentIntentId : paid.setupIntentId);
  const photos: BookingPhotosResult = business.clientPhotosOnBooking && input.photos?.length ? await addClientPhotos({ businessId: business.id, appointmentId: leadId, files: input.photos }) : { stored: 0, dropped: [] };
  // The booker's confirmation lists everyone. A guest with their own phone or email gets their own too; one without (a child) is
  // covered by the booker's, and still gets reminders (at a parent's, when linked).
  await notifyAppointment(business, leadId, "confirmation");
  const guestClients = await withTenant(business.id, (tx) => tx.select({ id: schema.clients.id, phone: schema.clients.phone, email: schema.clients.email }).from(schema.clients).where(inArray(schema.clients.id, guestIds.map((g) => g.id))));
  for (const [i, id] of made.slice(1).entries()) {
    const c = guestClients.find((x) => x.id === guestIds[i]!.id);
    if (c?.phone || c?.email) await notifyAppointment(business, id, "confirmation");
    else await afterAppointmentBooked(business, id, { reminders: true });
  }
  await alertBusiness(business, leadId, "booked");
  return { appointmentId: leadId, appointmentIds: made, token, photos };
}

/** The appointments booked together with this one, lead first then by start time (just this one when it isn't in a group). */
export async function groupAppointments(businessId: string, appointmentId: string) {
  return withTenant(businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId), columns: { id: true, groupId: true } });
    if (!appt) return [];
    if (!appt.groupId) return [appt.id];
    const rows = await tx
      .select({ id: schema.appointments.id, start: sql<Date>`(select min(${schema.appointmentItems.startAt}) from ${schema.appointmentItems} where ${schema.appointmentItems.appointmentId} = ${schema.appointments.id})` })
      .from(schema.appointments)
      .where(eq(schema.appointments.groupId, appt.groupId));
    return rows.sort((a, b) => (a.id === appt.groupId ? -1 : b.id === appt.groupId ? 1 : new Date(a.start).getTime() - new Date(b.start).getTime())).map((r) => r.id);
  });
}
