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

const bookingFields = contact.extend({ slug: z.string(), serviceId: z.string().min(1), staffId: z.string().min(1), quotedPriceCents: z.string().regex(/^\d+$/).optional().transform((v) => (v === undefined ? undefined : Number(v))), startAt: z.string().datetime(), classSessionId: z.string().optional().transform((v) => v || null), locationId: z.string().optional().transform((v) => v || null), extraServiceIds: z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 4) : [])), embed: z.string().optional() });
/** The confirmation page; pictures that could not be used travel along by name so the client sees which ones. */
const confirmedPath = (d: { slug: string; embed?: string }, token: string, photos?: BookingPhotosResult) => {
  const dropped = photos ? droppedParam(photos.dropped) : null;
  return `${d.embed ? "/embed" : "/book"}/${d.slug}/confirmed/${token}${dropped ? `?dropped=${encodeURIComponent(dropped)}` : ""}`;
};
type BookingFields = z.infer<typeof bookingFields>;

function parseBooking(raw: Record<string, unknown>): { d: BookingFields } | { error: string } {
  const parsed = bookingFields.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.phone) return { error: "Enter your mobile number so we can confirm your booking." };
  if (!d.email) return { error: "Enter your email so we can send your confirmation." };
  if (!normalizePhone(d.phone)) return { error: "Enter a valid mobile number." };
  return { d };
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
  const bot = await publicBotCheck(formData.get("cf-turnstile-response"));
  if (bot) return { error: bot };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
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
  let token: string;
  let photos: BookingPhotosResult | undefined;
  try {
    const r = await createOnlineBooking(business, { ...d, startAt: new Date(d.startAt), ip: formIp(await headers()), photos: bookingPhotosFrom(formData) });
    token = r.token;
    photos = r.photos;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(confirmedPath(d, token, photos));
}

export type StartPaymentResult = { clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string | null; publishableKey: string | null } | { error: string };

/**
 * Step 1 of a paid booking: validate the form and the slot, create the client,
 * and open a PaymentIntent (deposit) or SetupIntent (card on file) for the browser.
 */
export async function startOnlinePaymentAction(raw: Record<string, string>): Promise<StartPaymentResult> {
  const p = parseBooking(raw);
  if ("error" in p) return { error: p.error };
  // Checked before anything is charged or held; the finish step needs no second check (Stripe has confirmed the card by then).
  const bot = await publicBotCheck(raw["cf-turnstile-response"]);
  if (bot) return { error: bot };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, d.serviceId), eq(schema.services.active, true)) }));
  if (!service) return { error: "That service is no longer available." };
  try {
    await assertQuotedPrice(business, d);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  const pay = await paymentContextFor(business, d.locationId);
  let visitPrice: number;
  try {
    visitPrice = await priceFor(business, service, d);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  const req = onlinePaymentRequirement(business, service, pay, visitPrice);
  if (req.mode === "none") return { error: "No payment is needed for this booking. Please reload the page." };
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
    const clientId = await findOrCreateClient(business.id, { ...d, startAt });
    const r = await startOnlinePayment(business, pay, req.mode, { businessId: business.id, clientId, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "" }, req.amountCents);
    const browser = await browserStripe(r.accountId, process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    return { clientSecret: r.clientSecret, intentId: r.id, kind: r.kind, accountId: browser.stripeAccount, publishableKey: browser.publishableKey };
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

/** The client went back to edit their details before paying. */
export async function abandonOnlinePaymentAction(slug: string, locationId: string | null, intent: { kind: "deposit" | "card"; id: string }): Promise<void> {
  if (typeof slug !== "string" || !/^(pi|seti)_\w+$/.test(intent.id)) return;
  const business = await getPublicBusiness(slug);
  if (!business) return;
  await cancelOnlineIntent(business, await paymentContextFor(business, locationId || null), intent.kind, intent.id);
}

/** Step 2: the browser confirmed the intent. Verify with Stripe, then book. `photos` carries the pictures the client attached in step 1, if any. */
export async function finishOnlineBookingAction(raw: Record<string, string>, intent: { kind: "deposit" | "card"; id: string }, photos?: FormData | null): Promise<{ error?: string }> {
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
    const verified = await verifyOnlineIntent(business, pay, intent.kind, intent.id, { businessId: business.id, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "" });
    const r = await createOnlineBooking(business, { ...d, startAt, ip: formIp(await headers()), photos: bookingPhotosFrom(photos) }, new Date(), verified);
    token = r.token;
    result = r.photos;
  } catch (e) {
    const twin = await appointmentForIntent(business.id, intent.id);
    if (twin) redirect(confirmedPath(d, twin.manageToken));
    if (e instanceof BookingError) return { error: intent.kind === "deposit" && /just taken|no longer/.test(e.message) ? `${e.message} Your deposit has been refunded.` : e.message };
    throw e;
  }
  redirect(confirmedPath(d, token, result));
}

export async function cancelBooking(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), reasonId: z.string().optional() }).parse(Object.fromEntries(formData));
  let refundFailed = false;
  try {
    ({ refundFailed } = await cancelOnline(d.slug, d.token, d.reasonId || null));
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
