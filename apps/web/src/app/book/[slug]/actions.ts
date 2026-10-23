"use server";
import { headers } from "next/headers";
import { formIp } from "@/lib/rate-limit";
import { publicBotCheck } from "@/lib/turnstile";
import { redirect } from "next/navigation";
import { browserStripe } from "@/lib/stripe-demo";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { BookingError } from "@/server/booking";
import { PromoError, validatePromo } from "@/server/promos";
import { priceForStaff } from "@/server/stylist-pricing";
import { assertClassSeatOpen, assertQuotedPrice, assertSlotOpen, planExtras, type PublicBusiness, cancelOnline, createOnlineBooking, findOrCreateClient, getPublicBusiness, joinWaitlist, rescheduleOnline } from "@/server/public-booking";
import { appointmentForIntent, cancelOnlineIntent, onlinePaymentRequirement, startOnlinePayment, verifyOnlineIntent } from "@/server/online-payments";
import { getSession } from "@/server/classes";
import { paymentContextFor } from "@/server/locations";
import { schema, withTenant } from "@angelic/db";
import { and, eq } from "drizzle-orm";
import { bookingPhotosFrom, droppedParam } from "@/lib/booking-photos";
import type { BookingPhotosResult } from "@/server/public-booking";
import { checkBookingCode, contactVerified, sendBookingCode, VerificationError } from "@/server/booking-verification";
import { setClientSession } from "@/lib/client-session";
import { decodeGuests, guestDetailsFrom, type GuestChoice, type GuestDetails } from "@/lib/group-guests";
import { createGroupBooking, groupPaymentRequirement, groupSignature, planGroup } from "@/server/group-booking";

/** The booking code step: whether this booking may go ahead, and how the client proved it. */
async function proof(business: PublicBusiness, d: { phone: string | null; email: string | null; verifyToken?: string | null }) {
  if (!business.verifyBookingContact) return { ok: true, via: null, on: false } as const;
  const p = await contactVerified(business, d, d.verifyToken);
  return { ...p, on: true } as const;
}
/** Proven by a booking code (not merely signed in): the bot check already ran when that code was sent. */
async function provenByCode(business: PublicBusiness, d: { phone: string | null; email: string | null; verifyToken?: string | null }) {
  if (!business.verifyBookingContact || !d.verifyToken) return false;
  const p = await contactVerified(business, d, d.verifyToken);
  return p.ok && (p.via === "sms" || p.via === "email");
}
const NEEDS_CODE = "Confirm your mobile number with the code we send, then book.";

/** After a booking proven by code: the client stays signed in on this device, so the next booking skips the code. */
async function signInAfterBooking(business: PublicBusiness, slug: string, appointmentToken: string | null, clientId?: string | null) {
  // Only where clients have accounts (with "Not you?" and sign-out on the page): an invisible session on a shared device would put the
  // next person's booking on this client.
  if (!business.clientAccountsEnabled) return;
  const businessId = business.id;
  let id = clientId ?? null;
  if (!id && appointmentToken) id = (await withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.manageToken, appointmentToken), columns: { clientId: true } })))?.clientId ?? null;
  if (id) await setClientSession(businessId, slug, id);
}

/** Send the booking code to the phone typed on the form (or the email, when asked or when texting isn't set up). */
export async function sendBookingCodeAction(input: { slug: string; phone: string; email: string; via?: "sms" | "email"; token?: string | null; botToken?: string | null }): Promise<{ channel: "sms" | "email"; to: string } | { verified: true } | { error: string }> {
  const business = await getPublicBusiness(String(input.slug));
  if (!business) return { error: "Online booking is not available." };
  // The bot check guards the code (every code is a text or an email we pay for), not just the booking.
  const bot = await publicBotCheck(input.botToken ?? null);
  if (bot) return { error: bot };
  const phone = normalizePhone(String(input.phone ?? ""));
  const email = String(input.email ?? "").trim() || null;
  if (!phone) return { error: "Enter a valid mobile number." };
  if ((await contactVerified(business, { phone, email }, input.token)).ok) return { verified: true };
  try {
    return await sendBookingCode(business, { phone, email, via: input.via === "email" ? "email" : undefined });
  } catch (e) {
    if (e instanceof VerificationError) return { error: e.message };
    throw e;
  }
}

export async function checkBookingCodeAction(input: { slug: string; phone: string; email: string; channel: "sms" | "email"; code: string }): Promise<{ token: string } | { error: string }> {
  const business = await getPublicBusiness(String(input.slug));
  if (!business) return { error: "Online booking is not available." };
  try {
    const token = await checkBookingCode(business, { phone: String(input.phone ?? ""), email: String(input.email ?? "") || null, channel: input.channel === "email" ? "email" : "sms", code: String(input.code ?? "") });
    return { token };
  } catch (e) {
    if (e instanceof VerificationError) return { error: e.message };
    throw e;
  }
}

export type PublicState = { error?: string; ok?: boolean } | undefined;

const contact = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).default(""),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => v || null),
  notes: z.string().trim().max(1000).transform((v) => v || null),
  smsConsent: z.string().optional().transform((v) => v === "on"),
  smsMarketingConsent: z.string().optional().transform((v) => v === "on"),
  referralCode: z.string().trim().max(40).optional().transform((v) => v || null),
  promoCode: z.string().trim().max(40).optional().transform((v) => v || null),
});

const bookingFields = contact.extend({ verifyToken: z.string().max(600).optional().transform((v) => v || null), slug: z.string(), serviceId: z.string().min(1), staffId: z.string().min(1), quotedPriceCents: z.string().regex(/^\d+$/).optional().transform((v) => (v === undefined ? undefined : Number(v))), startAt: z.string().datetime(), classSessionId: z.string().optional().transform((v) => v || null), locationId: z.string().optional().transform((v) => v || null), extraServiceIds: z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 4) : [])), embed: z.string().optional(), guests: z.string().max(1000).optional().transform((v) => decodeGuests(v)), forClientId: z.string().max(64).optional().transform((v) => v || null) });
/** The confirmation page; pictures that could not be used travel along by name so the client sees which ones. */
const confirmedPath = (d: { slug: string; embed?: string }, token: string, photos?: BookingPhotosResult) => {
  const dropped = photos ? droppedParam(photos.dropped) : null;
  return `${d.embed ? "/embed" : "/book"}/${d.slug}/confirmed/${token}${dropped ? `?dropped=${encodeURIComponent(dropped)}` : ""}`;
};
type BookingFields = z.infer<typeof bookingFields>;

function parseBooking(raw: Record<string, unknown>): { d: BookingFields; guestDetails: GuestDetails[] } | { error: string } {
  const parsed = bookingFields.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.phone) return { error: "Enter your mobile number so we can confirm your booking." };
  if (!d.email) return { error: "Enter your email so we can send your confirmation." };
  if (!normalizePhone(d.phone)) return { error: "Enter a valid mobile number." };
  if (d.guests.length && d.classSessionId) return { error: "Guests can't be added to a class booking." };
  const guestDetails = guestDetailsFrom(raw, d.guests.length);
  if ("error" in guestDetails) return guestDetails;
  return { d, guestDetails };
}

/** Guests on this booking: their plan and what the whole group pays up front. Throws a BookingError when someone doesn't fit. */
async function groupQuote(business: PublicBusiness, d: BookingFields & { guests: GuestChoice[] }) {
  const pay = await paymentContextFor(business, d.locationId);
  const plan = await planGroup(business, { serviceId: d.serviceId, staffId: d.staffId, startAt: new Date(d.startAt), extraServiceIds: d.extraServiceIds, locationId: d.locationId, guests: d.guests });
  return { pay, plan, req: groupPaymentRequirement(business, pay, plan) };
}

/** What this visit costs: this stylist's price for the service (classes are priced per seat), plus any services added to it. */
async function priceFor(business: PublicBusiness, service: { id: string; priceCents: number }, d: { staffId: string; classSessionId: string | null; startAt: string; extraServiceIds: string[]; locationId: string | null }): Promise<number> {
  if (d.classSessionId) return service.priceCents;
  const own = (await priceForStaff(business.id, service.id, d.staffId)) ?? service.priceCents;
  const extras = await planExtras(business, { serviceId: service.id, staffId: d.staffId, startAt: new Date(d.startAt), extraServiceIds: d.extraServiceIds, locationId: d.locationId });
  return own + extras.reduce((s, x) => s + x.priceCents, 0);
}

export async function bookOnline(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const p = parseBooking(Object.fromEntries(formData));
  if ("error" in p) return { error: p.error };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  // A booking proven by code passed the bot check when the code was sent (its token may have expired while the client fetched the code).
  if (!(await provenByCode(business, d))) {
    const bot = await publicBotCheck(formData.get("cf-turnstile-response"));
    if (bot) return { error: bot };
  }
  if (d.guests.length) return bookGroup(business, d, p.guestDetails, formData);
  // Services that need a deposit or a card must go through the payment steps below.
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, d.serviceId), eq(schema.services.active, true)) }));
  if (!service) return { error: "That service is no longer available." };
  const pay = await paymentContextFor(business, d.locationId);
  let visitPrice: number;
  try {
    visitPrice = await priceFor(business, service, d);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  if (onlinePaymentRequirement(business, service, pay, visitPrice).mode !== "none") return { error: "This booking needs a card. Please reload the page and try again." };
  const verified = await proof(business, d);
  if (!verified.ok) return { error: NEEDS_CODE };
  let token: string;
  let photos: BookingPhotosResult | undefined;
  try {
    const r = await createOnlineBooking(business, { ...d, startAt: new Date(d.startAt), ip: formIp(await headers()), photos: bookingPhotosFrom(formData), verifiedVia: verified.via, verificationOn: verified.on });
    token = r.token;
    photos = r.photos;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  if (verified.via === "sms" || verified.via === "email") await signInAfterBooking(business, d.slug, token);
  redirect(confirmedPath(d, token, photos));
}

/** A free booking with guests: everyone fits, nobody needs a card, one proof of contact covers the group. */
async function bookGroup(business: PublicBusiness, d: BookingFields, guestDetails: GuestDetails[], formData: FormData): Promise<PublicState> {
  let token: string;
  let photos: BookingPhotosResult | undefined;
  let verified: Awaited<ReturnType<typeof proof>>;
  try {
    const { pay, req } = await groupQuote(business, d);
    if (req.mode !== "none") return { error: "This booking needs a card. Please reload the page and try again." };
    verified = await proof(business, d);
    if (!verified.ok) return { error: NEEDS_CODE };
    const r = await createGroupBooking(business, pay, { ...d, startAt: new Date(d.startAt), ip: formIp(await headers()), photos: bookingPhotosFrom(formData), verifiedVia: verified.via, verificationOn: verified.on, guestDetails });
    token = r.token;
    photos = r.photos;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  if (verified.via === "sms" || verified.via === "email") await signInAfterBooking(business, d.slug, token);
  redirect(confirmedPath(d, token, photos));
}

export type StartPaymentResult =
  | { provider: "stripe"; clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string | null; publishableKey: string | null }
  | { provider: "helcim"; checkoutToken: string; intentId: string; kind: "deposit" | "card" }
  | { error: string };

/**
 * Step 1 of a paid booking: validate the form and the slot, create the client,
 * and open a PaymentIntent (deposit) or SetupIntent (card on file) for the browser.
 */
export async function startOnlinePaymentAction(raw: Record<string, string>): Promise<StartPaymentResult> {
  const p = parseBooking(raw);
  if ("error" in p) return { error: p.error };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  // Checked before anything is charged or held (unless already passed when the booking code was sent); the finish step needs no second
  // check (the card has been confirmed by then).
  if (!(await provenByCode(business, d))) {
    const bot = await publicBotCheck(raw["cf-turnstile-response"]);
    if (bot) return { error: bot };
  }
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, d.serviceId), eq(schema.services.active, true)) }));
  if (!service) return { error: "That service is no longer available." };
  try {
    await assertQuotedPrice(business, d);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  const pay = await paymentContextFor(business, d.locationId);
  let req: { mode: "deposit" | "card" | "none"; amountCents: number };
  try {
    // With guests, each person's deposit is worked out on their own visit and the group pays the total in one charge.
    req = d.guests.length ? (await groupQuote(business, d)).req : onlinePaymentRequirement(business, service, pay, await priceFor(business, service, d));
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  if (req.mode === "none") return { error: "No payment is needed for this booking. Please reload the page." };
  // Proven before any card is charged or saved.
  const verified = await proof(business, d);
  if (!verified.ok) return { error: NEEDS_CODE };
  const startAt = new Date(d.startAt);
  // A bad promo code must fail here, before a deposit is taken, not after (charge-then-refund).
  if (d.promoCode) {
    try {
      await withTenant(business.id, (tx) => validatePromo(tx, d.promoCode!, { serviceIds: [d.serviceId] }));
    } catch (e) {
      if (e instanceof PromoError) return { error: e.message };
      throw e;
    }
  }
  try {
    if (d.classSessionId) await assertSeatOpen(business, d.classSessionId, d.serviceId, d.staffId, startAt);
    else await assertSlotOpen(business, d.serviceId, d.staffId, startAt, new Date(), d.locationId);
    const clientId = await findOrCreateClient(business.id, { ...d, startAt, verifiedVia: verified.via, verificationOn: verified.on });
    const r = await startOnlinePayment(business, pay, req.mode, { businessId: business.id, clientId, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "", group: groupSignature(d.guests) }, req.amountCents);
    if (r.provider === "helcim") return { provider: "helcim", checkoutToken: r.checkoutToken, intentId: r.id, kind: r.kind };
    const browser = await browserStripe(r.accountId!, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    return { provider: "stripe", clientSecret: r.clientSecret, intentId: r.id, kind: r.kind, accountId: browser.stripeAccount, publishableKey: browser.publishableKey };
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

/** The client went back to edit their details before paying. */
export async function abandonOnlinePaymentAction(slug: string, locationId: string | null, intent: { kind: "deposit" | "card"; id: string }): Promise<void> {
  // A Stripe intent (pi_ / seti_) or a Helcim checkout id (a uuid).
  if (typeof slug !== "string" || !/^((pi|seti)_\w+|[0-9a-f-]{36})$/.test(intent.id)) return;
  const business = await getPublicBusiness(slug);
  if (!business) return;
  await cancelOnlineIntent(business, await paymentContextFor(business, locationId || null), intent.kind, intent.id);
}

/** Step 2: the browser confirmed the intent. Verify with Stripe, then book. `photos` carries the pictures the client attached in step 1, if any. */
export async function finishOnlineBookingAction(raw: Record<string, string>, intent: { kind: "deposit" | "card"; id: string; /** Helcim: HelcimPay.js's answer, verified on the server. */ helcim?: unknown }, photos?: FormData | null): Promise<{ error?: string }> {
  const p = parseBooking(raw);
  if ("error" in p) return { error: p.error };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  const existing = await appointmentForIntent(business.id, intent.id);
  if (existing) redirect(confirmedPath(d, existing.manageToken));
  let token: string;
  let result: BookingPhotosResult | undefined;
  try {
    const startAt = new Date(d.startAt);
    const pay = await paymentContextFor(business, d.locationId);
    const verified = await verifyOnlineIntent(business, pay, intent.kind, intent.id, { businessId: business.id, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "", group: groupSignature(d.guests) }, intent.helcim);
    const v = await proof(business, d);
    const base = { ...d, startAt, ip: formIp(await headers()), photos: bookingPhotosFrom(photos), verifiedVia: v.via, verificationOn: v.on };
    const r = d.guests.length ? await createGroupBooking(business, pay, { ...base, guestDetails: p.guestDetails }, new Date(), verified) : await createOnlineBooking(business, base, new Date(), verified);
    token = r.token;
    result = r.photos;
    if (v.via === "sms" || v.via === "email") await signInAfterBooking(business, d.slug, null, verified.meta.clientId);
  } catch (e) {
    const twin = await appointmentForIntent(business.id, intent.id);
    if (twin) redirect(confirmedPath(d, twin.manageToken));
    if (e instanceof BookingError) return { error: intent.kind === "deposit" && /just taken|no longer/.test(e.message) ? `${e.message} Your deposit has been refunded.` : e.message };
    throw e;
  }
  redirect(confirmedPath(d, token, result));
}

export async function cancelBooking(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), reasonId: z.string().optional(), scope: z.enum(["one", "all"]).optional() }).parse(Object.fromEntries(formData));
  let refundFailed = false;
  try {
    ({ refundFailed } = await cancelOnline(d.slug, d.token, d.reasonId || null, d.scope === "all"));
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/book/${d.slug}/manage/${d.token}?cancelled=1${refundFailed ? "&refund=pending" : ""}`);
}

export async function rescheduleBooking(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), startAt: z.string().datetime(), staff: z.string().optional() }).parse(Object.fromEntries(formData));
  try {
    await rescheduleOnline(d.slug, d.token, new Date(d.startAt), d.staff || null);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/book/${d.slug}/manage/${d.token}?moved=1`);
}

export async function joinWaitlistAction(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const parsed = contact
    .extend({ slug: z.string(), serviceId: z.string().min(1), staffId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: z.string().optional().transform((v) => v || null) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.phone) return { error: "Enter your mobile number so we can reach you." };
  const bot = await publicBotCheck(formData.get("cf-turnstile-response"));
  if (bot) return { error: bot };
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  try {
    await joinWaitlist(business, { ...d, staffId: d.staffId && d.staffId !== "any" ? d.staffId : null });
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  return { ok: true };
}

/** A class seat is still open and the hidden fields describe that session (and its service, so the deposit is the class's). */
async function assertSeatOpen(business: PublicBusiness, sessionId: string, serviceId: string, staffId: string, startAt: Date) {
  await assertClassSeatOpen(business, { classSessionId: sessionId, serviceId, staffId, startAt });
}
