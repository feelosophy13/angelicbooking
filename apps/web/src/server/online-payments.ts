/**
 * Money at online booking, on the business's own Stripe account:
 *   - deposit: a PaymentIntent for the service's deposit, card saved for later
 *     (no-show fee, remaining balance at checkout);
 *   - card on file: a SetupIntent that saves the card without charging it.
 * The appointment is only created once Stripe reports the intent succeeded, so
 * a slot is never held by someone whose card failed. If the slot was taken in
 * the meantime the deposit is refunded automatically.
 */
import type Stripe from "stripe";
import { eq, or } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { changeStoreCredit } from "./store-credit";
import { stripe } from "@/lib/stripe";
import { platformFeeBpsFor } from "./price-book";
import { ensureStripeCustomer } from "./stripe-connect";
import { BookingError } from "./booking";
import type { PublicBusiness } from "./public-booking";
import type { PaymentContext } from "./locations";

export type PaymentMode = "deposit" | "card" | "none";

type DepositTerms = { depositCents: number; depositType: string; depositPercent: number };

/** What booking this service online collects up front, in cents, given the price this stylist charges (never more than the price). */
export function depositAmount(service: DepositTerms, priceCents: number): number {
  const raw = service.depositType === "full" ? priceCents : service.depositType === "percent" ? Math.round((priceCents * service.depositPercent) / 100) : service.depositCents;
  return Math.min(raw, priceCents);
}

/** The short label for a service's up-front payment ("$50.00 deposit", "25% deposit", "Pay in full"); null when there is none. */
export function depositLabel(service: DepositTerms, money: (cents: number) => string): string | null {
  if (service.depositType === "full") return "Pay in full";
  if (service.depositType === "percent") return service.depositPercent > 0 ? `${service.depositPercent}% deposit` : null;
  return service.depositCents > 0 ? `${money(service.depositCents)} deposit` : null;
}

/** What (if anything) the booking page must collect before this service can be booked at this location. */
export function onlinePaymentRequirement(business: PublicBusiness, service: DepositTerms, pay: PaymentContext, priceCents: number): { mode: PaymentMode; amountCents: number; full: boolean } {
  const ready = pay.ready && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!ready) return { mode: "none", amountCents: 0, full: false };
  const due = depositAmount(service, priceCents);
  if (due >= 50) return { mode: "deposit", amountCents: due, full: service.depositType === "full" || due >= priceCents };
  if (business.requireCardOnline) return { mode: "card", amountCents: 0, full: false };
  return { mode: "none", amountCents: 0, full: false };
}

export interface IntentMeta {
  businessId: string;
  clientId: string;
  serviceId: string;
  staffId: string;
  startAt: string; // ISO
  /** Location the booking is for ("" when the business has one site). */
  locationId: string;
}

/** Create the PaymentIntent / SetupIntent the browser will confirm, on the location's Stripe account. */
export async function startOnlinePayment(business: PublicBusiness, pay: PaymentContext, mode: Exclude<PaymentMode, "none">, meta: IntentMeta, amountCents: number) {
  const accountId = pay.accountId;
  if (!accountId || !pay.ready) throw new BookingError("Online payments are not set up.");
  const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, meta.clientId) }));
  if (!client) throw new BookingError("Client not found.");
  const customer = await withTenant(business.id, (tx) => ensureStripeCustomer({ accountId, businessId: business.id, client, tx }));
  const metadata = { ...meta, kind: mode };
  if (mode === "deposit") {
    const fee = Math.round((amountCents * (await platformFeeBpsFor(business.id))) / 10_000);
    const pi = await stripe().paymentIntents.create(
      {
        amount: amountCents,
        currency: business.currency,
        customer,
        allowed_payment_method_types: ["card"],
        setup_future_usage: "off_session",
        description: `Deposit · ${pay.name}`,
        metadata,
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: accountId },
    );
    return { kind: "deposit" as const, id: pi.id, clientSecret: pi.client_secret!, accountId };
  }
  const si = await stripe().setupIntents.create({ customer, allowed_payment_method_types: ["card"], usage: "off_session", metadata }, { stripeAccount: accountId });
  return { kind: "card" as const, id: si.id, clientSecret: si.client_secret!, accountId };
}

/** The client went back to edit their details: drop the unpaid intent so abandoned ones don't pile up. Best effort; only ours and only if nothing was paid. */
export async function cancelOnlineIntent(business: PublicBusiness, pay: PaymentContext, kind: "deposit" | "card", intentId: string): Promise<void> {
  const accountId = pay.accountId;
  if (!accountId) return;
  const opts = { stripeAccount: accountId };
  try {
    if (kind === "deposit") {
      const pi = await stripe().paymentIntents.retrieve(intentId, undefined, opts);
      if (pi.metadata.businessId === business.id && ["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) await stripe().paymentIntents.cancel(intentId, undefined, opts);
    } else {
      const si = await stripe().setupIntents.retrieve(intentId, undefined, opts);
      if (si.metadata?.businessId === business.id && ["requires_payment_method", "requires_confirmation", "requires_action"].includes(si.status)) await stripe().setupIntents.cancel(intentId, undefined, opts);
    }
  } catch (e) {
    console.error("[online-payments] could not cancel abandoned intent", intentId, (e as Error).message);
  }
}

export type VerifiedIntent =
  | { kind: "deposit"; paymentIntentId: string; cents: number; cardLabel: string | null; meta: IntentMeta }
  | { kind: "card"; setupIntentId: string; meta: IntentMeta };

/** Fetch the intent from Stripe and make sure it is ours, succeeded, and for the booking being made. */
export async function verifyOnlineIntent(business: PublicBusiness, pay: PaymentContext, kind: "deposit" | "card", intentId: string, expected: Omit<IntentMeta, "clientId">): Promise<VerifiedIntent> {
  const accountId = pay.accountId;
  if (!accountId) throw new BookingError("Online payments are not set up.");
  const check = (md: Stripe.Metadata) => {
    if (md.businessId !== expected.businessId || md.serviceId !== expected.serviceId || md.staffId !== expected.staffId || md.startAt !== expected.startAt || (md.locationId ?? "") !== expected.locationId || !md.clientId) {
      throw new BookingError("That payment doesn't match this booking. Please start again.");
    }
    return { businessId: md.businessId, clientId: md.clientId, serviceId: md.serviceId, staffId: md.staffId, startAt: md.startAt, locationId: md.locationId ?? "" } satisfies IntentMeta;
  };
  if (kind === "deposit") {
    const pi = await stripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
    const meta = check(pi.metadata);
    if (pi.status !== "succeeded") throw new BookingError(`Your card was not charged (${pi.status.replace(/_/g, " ")}). Please try again.`);
    const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
    const card = charge?.payment_method_details?.card;
    return { kind, paymentIntentId: pi.id, cents: pi.amount, cardLabel: card ? `${card.brand?.toUpperCase() ?? "CARD"} •••• ${card.last4 ?? ""}` : null, meta };
  }
  const si = await stripe().setupIntents.retrieve(intentId, {}, { stripeAccount: accountId });
  const meta = check(si.metadata ?? {});
  if (si.status !== "succeeded") throw new BookingError(`Your card could not be saved (${si.status.replace(/_/g, " ")}). Please try again.`);
  return { kind, setupIntentId: si.id, meta };
}

/** The appointment already created for this intent, if the client refreshed the page after booking. */
export async function appointmentForIntent(businessId: string, intentId: string) {
  return withTenant(businessId, (tx) => tx.query.appointments.findFirst({ where: or(eq(schema.appointments.depositPaymentIntentId, intentId), eq(schema.appointments.cardSetupIntentId, intentId)) }));
}

/**
 * Refund a deposit that has not been applied to a sale yet (online cancellation
 * inside the policy window, staff courtesy refund, or a booking that failed after
 * the charge). Idempotent: does nothing unless the deposit is in "paid".
 */
export async function refundDeposit(input: { businessId: string; accountId: string | null; appointmentId: string; actorUserId: string; reason: string; /** Give back only part of the deposit (the rest stays as the late-cancel fee); default is all of it. */ amountCents?: number; /** Override the business policy (staff choosing explicitly). */ as?: "original" | "store_credit" }) {
  return withTenant(input.businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
    if (!appt || appt.depositStatus !== "paid" || !appt.depositPaymentIntentId) return false;
    const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { depositRefundAs: true } });
    const refundCents = Math.min(appt.depositCents, Math.max(1, Math.round(input.amountCents ?? appt.depositCents)));
    const partial = refundCents < appt.depositCents;
    const as = input.as ?? (biz?.depositRefundAs === "store_credit" ? "store_credit" : "original");
    // Under a store-credit policy the money stays on the account and the client gets a balance instead.
    if (as === "store_credit" && appt.clientId) {
      await changeStoreCredit(tx, { businessId: input.businessId, clientId: appt.clientId, deltaCents: refundCents, reason: "deposit_refund", appointmentId: appt.id, note: input.reason, actorUserId: input.actorUserId });
      await tx.update(schema.appointments).set(partial ? { depositCents: appt.depositCents - refundCents } : { depositStatus: "refunded" }).where(eq(schema.appointments.id, appt.id));
      await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "deposit.store_credit", entity: "appointment", entityId: appt.id, diff: JSON.stringify({ cents: refundCents, kept: appt.depositCents - refundCents, reason: input.reason }) });
      return true;
    }
    if (!input.accountId) throw new BookingError("Stripe account not connected.");
    // A partial refund names its amount (and carries it in the idempotency key); a full one lets Stripe refund what is left.
    await stripe().refunds.create({ payment_intent: appt.depositPaymentIntentId, ...(partial ? { amount: refundCents } : {}), metadata: { appointmentId: appt.id, reason: input.reason } }, { stripeAccount: input.accountId, idempotencyKey: `deposit_refund_${appt.id}_${partial ? refundCents : "all"}` });
    // After a partial refund the deposit is what the salon kept; it stays "paid" so it can still be applied to the visit's bill or the fee.
    await tx.update(schema.appointments).set(partial ? { depositCents: appt.depositCents - refundCents } : { depositStatus: "refunded" }).where(eq(schema.appointments.id, appt.id));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "deposit.refund", entity: "appointment", entityId: appt.id, diff: JSON.stringify({ cents: refundCents, kept: appt.depositCents - refundCents, reason: input.reason }) });
    return true;
  });
}

/** Refund a PaymentIntent that never became an appointment (slot taken after the charge). */
export async function refundOrphanIntent(accountId: string, paymentIntentId: string) {
  await stripe().refunds.create({ payment_intent: paymentIntentId, metadata: { reason: "booking_failed" } }, { stripeAccount: accountId, idempotencyKey: `orphan_refund_${paymentIntentId}` });
}
