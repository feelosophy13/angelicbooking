"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { BookingError } from "@/server/booking";
import { assertSlotOpen, cancelOnline, createOnlineBooking, findOrCreateClient, getPublicBusiness, joinWaitlist, rescheduleOnline } from "@/server/public-booking";
import { appointmentForIntent, onlinePaymentRequirement, startOnlinePayment, verifyOnlineIntent } from "@/server/online-payments";
import { getSession } from "@/server/classes";
import { paymentContextFor } from "@/server/locations";
import { schema, withTenant } from "@angelic/db";
import { and, eq } from "drizzle-orm";

export type PublicState = { error?: string; ok?: boolean } | undefined;

const contact = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).default(""),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => v || null),
  notes: z.string().trim().max(1000).transform((v) => v || null),
  smsConsent: z.string().optional().transform((v) => v === "on"),
  referralCode: z.string().trim().max(40).optional().transform((v) => v || null),
  promoCode: z.string().trim().max(40).optional().transform((v) => v || null),
});

const bookingFields = contact.extend({ slug: z.string(), serviceId: z.string().min(1), staffId: z.string().min(1), startAt: z.string().datetime(), classSessionId: z.string().optional().transform((v) => v || null), locationId: z.string().optional().transform((v) => v || null), embed: z.string().optional() });
const confirmedPath = (d: { slug: string; embed?: string }, token: string) => `${d.embed ? "/embed" : "/book"}/${d.slug}/confirmed/${token}`;
type BookingFields = z.infer<typeof bookingFields>;

function parseBooking(raw: Record<string, unknown>): { d: BookingFields } | { error: string } {
  const parsed = bookingFields.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.email && !d.phone) return { error: "Enter an email or a mobile number so we can confirm your booking." };
  if (d.phone && !normalizePhone(d.phone)) return { error: "Enter a valid mobile number." };
  return { d };
}

export async function bookOnline(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const p = parseBooking(Object.fromEntries(formData));
  if ("error" in p) return { error: p.error };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  // Services that need a deposit or a card must go through the payment steps below.
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, d.serviceId), eq(schema.services.active, true)) }));
  if (!service) return { error: "That service is no longer available." };
  const pay = await paymentContextFor(business, d.locationId);
  if (onlinePaymentRequirement(business, service, pay).mode !== "none") return { error: "This booking needs a card. Please reload the page and try again." };
  let token: string;
  try {
    const r = await createOnlineBooking(business, { ...d, startAt: new Date(d.startAt) });
    token = r.token;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(confirmedPath(d, token));
}

export type StartPaymentResult = { clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string } | { error: string };

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
  const service = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: and(eq(schema.services.id, d.serviceId), eq(schema.services.active, true)) }));
  if (!service) return { error: "That service is no longer available." };
  const pay = await paymentContextFor(business, d.locationId);
  const req = onlinePaymentRequirement(business, service, pay);
  if (req.mode === "none") return { error: "No payment is needed for this booking. Please reload the page." };
  const startAt = new Date(d.startAt);
  try {
    if (d.classSessionId) await assertSeatOpen(business.id, d.classSessionId, d.staffId, startAt);
    else await assertSlotOpen(business, d.serviceId, d.staffId, startAt, new Date(), d.locationId);
    const clientId = await findOrCreateClient(business.id, { ...d, startAt });
    const r = await startOnlinePayment(business, pay, req.mode, { businessId: business.id, clientId, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "" }, req.amountCents);
    return { clientSecret: r.clientSecret, intentId: r.id, kind: r.kind, accountId: r.accountId };
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

/** Step 2: the browser confirmed the intent. Verify with Stripe, then book. */
export async function finishOnlineBookingAction(raw: Record<string, string>, intent: { kind: "deposit" | "card"; id: string }): Promise<{ error?: string }> {
  const p = parseBooking(raw);
  if ("error" in p) return { error: p.error };
  const d = p.d;
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  const existing = await appointmentForIntent(business.id, intent.id);
  if (existing) redirect(confirmedPath(d, existing.manageToken));
  let token: string;
  try {
    const startAt = new Date(d.startAt);
    const pay = await paymentContextFor(business, d.locationId);
    const verified = await verifyOnlineIntent(business, pay, intent.kind, intent.id, { businessId: business.id, serviceId: d.serviceId, staffId: d.staffId, startAt: startAt.toISOString(), locationId: d.locationId ?? "" });
    const r = await createOnlineBooking(business, { ...d, startAt }, new Date(), verified);
    token = r.token;
  } catch (e) {
    if (e instanceof BookingError) return { error: intent.kind === "deposit" && /just taken|no longer/.test(e.message) ? `${e.message} Your deposit has been refunded.` : e.message };
    throw e;
  }
  redirect(confirmedPath(d, token));
}

export async function cancelBooking(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10) }).parse(Object.fromEntries(formData));
  try {
    await cancelOnline(d.slug, d.token);
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/book/${d.slug}/manage/${d.token}?cancelled=1`);
}

export async function rescheduleBooking(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), startAt: z.string().datetime() }).parse(Object.fromEntries(formData));
  try {
    await rescheduleOnline(d.slug, d.token, new Date(d.startAt));
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
  if (!d.email && !d.phone) return { error: "Enter an email or mobile number so we can reach you." };
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  await joinWaitlist(business, { ...d, staffId: d.staffId && d.staffId !== "any" ? d.staffId : null });
  return { ok: true };
}

/** A class seat is still open and the hidden fields describe that session. */
async function assertSeatOpen(businessId: string, sessionId: string, staffId: string, startAt: Date) {
  const s = await getSession(businessId, sessionId);
  if (!s || s.session.status !== "scheduled") throw new BookingError("That class is no longer scheduled.");
  if (s.session.staffId !== staffId || s.session.startAt.getTime() !== startAt.getTime()) throw new BookingError("That class has changed. Please reload and pick it again.");
  if (s.seatsLeft <= 0) throw new BookingError("This class is full.");
}
