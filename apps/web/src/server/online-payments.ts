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
import { and, eq, or, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { changeStoreCredit } from "./store-credit";
import { stripe } from "@/lib/stripe";
import { platformFeeBpsFor } from "./price-book";
import { ensureStripeCustomer } from "./stripe-connect";
import { BookingError } from "./booking";
import type { PublicBusiness } from "./public-booking";
import type { PaymentContext } from "./locations";
import { helcimTokenOf } from "./helcim/account";
import { HelcimCheckoutError, openHelcimCheckout, refundHelcimTransaction, verifyHelcimCheckout, voidHelcimCheckout } from "./helcim/online";
import { cardFeeFor, cardFeeSettingsOf } from "@angelic/core";
import { stripeCardFunding } from "./sales";

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
  const ready = (pay.ready && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || pay.helcimReady;
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
  // Helcim: a HelcimPay.js checkout (deposit = purchase, card hold = verify) instead of a PaymentIntent / SetupIntent.
  if (pay.provider === "helcim") {
    const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, meta.clientId) }));
    if (!client) throw new BookingError("Client not found.");
    // Helcim can't say whether the card is debit before charging, so with debit exempt no card fee is added ("unknown").
    const cardFee = mode === "deposit" ? cardFeeFor(cardFeeSettingsOf(business), "online", amountCents, "unknown") : 0;
    try {
      const r = await openHelcimCheckout(business, { purpose: mode, meta: { ...meta, kind: mode, ...(cardFee ? { cardFeeCents: String(cardFee) } : {}) }, amountCents: amountCents + cardFee, client });
      return { provider: "helcim" as const, kind: mode, id: r.id, checkoutToken: r.checkoutToken, clientSecret: "", accountId: null };
    } catch (e) {
      throw new BookingError(e instanceof HelcimCheckoutError ? e.message : "Online payments are unavailable right now. Please try again.");
    }
  }
  const accountId = pay.accountId;
  if (!accountId || !pay.ready) throw new BookingError("Online payments are not set up.");
  const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, meta.clientId) }));
  if (!client) throw new BookingError("Client not found.");
  const customer = await ensureStripeCustomer({ accountId, businessId: business.id, client });
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
    return { provider: "stripe" as const, kind: "deposit" as const, id: pi.id, checkoutToken: null, clientSecret: pi.client_secret!, accountId };
  }
  const si = await stripe().setupIntents.create({ customer, allowed_payment_method_types: ["card"], usage: "off_session", metadata }, { stripeAccount: accountId });
  return { provider: "stripe" as const, kind: "card" as const, id: si.id, checkoutToken: null, clientSecret: si.client_secret!, accountId };
}

/**
 * Stripe deposit, once the client has entered a card (or picked one in Apple Pay / Google Pay): with a card fee on for online deposits, Stripe
 * says whether the card is debit, and the PaymentIntent becomes deposit + fee with that card attached, ready for the browser to confirm.
 * The fee rides in the metadata, so the booking records the deposit and the fee apart. Returns what the card will be charged.
 */
export async function applyOnlineDepositFee(business: PublicBusiness, pay: PaymentContext, intentId: string, paymentMethodId: string): Promise<{ cardFeeCents: number; totalCents: number }> {
  const accountId = pay.accountId;
  if (pay.provider === "helcim" || !accountId) throw new BookingError("Online payments are not set up.");
  const opts = { stripeAccount: accountId };
  const pi = await stripe().paymentIntents.retrieve(intentId, undefined, opts);
  if (pi.metadata.businessId !== business.id || pi.metadata.kind !== "deposit") throw new BookingError("That payment doesn't match this booking. Please start again.");
  if (!["requires_payment_method", "requires_confirmation"].includes(pi.status)) throw new BookingError("This payment has already been started. Please refresh the page.");
  const deposit = pi.amount - Number(pi.metadata.cardFeeCents ?? 0);
  const settings = cardFeeSettingsOf(business);
  const cardFee = cardFeeFor(settings, "online", deposit, await stripeCardFunding(accountId, paymentMethodId));
  const total = deposit + cardFee;
  const fee = Math.round((total * (await platformFeeBpsFor(business.id))) / 10_000);
  await stripe().paymentIntents.update(intentId, { amount: total, payment_method: paymentMethodId, metadata: { cardFeeCents: String(cardFee) }, ...(fee > 0 ? { application_fee_amount: fee } : {}) }, opts);
  return { cardFeeCents: cardFee, totalCents: total };
}

/** The client went back to edit their details: drop the unpaid intent so abandoned ones don't pile up. Best effort; only ours and only if nothing was paid. */
export async function cancelOnlineIntent(business: PublicBusiness, pay: PaymentContext, kind: "deposit" | "card", intentId: string): Promise<void> {
  if (pay.provider === "helcim") return voidHelcimCheckout(business.id, intentId);
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
  | { kind: "deposit"; paymentIntentId: string; /** The deposit, without any card fee. */ cents: number; /** The card fee charged with it. */ surchargeCents: number; cardLabel: string | null; meta: IntentMeta; accountId: string; provider?: "stripe" | "helcim"; providerPaymentId?: string | null }
  | { kind: "card"; setupIntentId: string; meta: IntentMeta; provider?: "stripe" | "helcim" };

/** Fetch the intent from Stripe and make sure it is ours, succeeded, and for the booking being made. */
export async function verifyOnlineIntent(business: PublicBusiness, pay: PaymentContext, kind: "deposit" | "card", intentId: string, expected: Omit<IntentMeta, "clientId">, /** Helcim: the HelcimPay.js answer from the browser. */ eventMessage?: unknown): Promise<VerifiedIntent> {
  const check = (md: Stripe.Metadata) => {
    if (md.businessId !== expected.businessId || md.serviceId !== expected.serviceId || md.staffId !== expected.staffId || md.startAt !== expected.startAt || (md.locationId ?? "") !== expected.locationId || !md.clientId) {
      throw new BookingError("That payment doesn't match this booking. Please start again.");
    }
    return { businessId: md.businessId, clientId: md.clientId, serviceId: md.serviceId, staffId: md.staffId, startAt: md.startAt, locationId: md.locationId ?? "" } satisfies IntentMeta;
  };
  if (pay.provider === "helcim") {
    let row;
    try {
      row = await verifyHelcimCheckout(business, intentId, eventMessage);
    } catch (e) {
      if (e instanceof HelcimCheckoutError) throw new BookingError(e.message);
      throw e;
    }
    const meta = check(row.meta);
    if (row.purpose !== kind) throw new BookingError("That payment doesn't match this booking. Please start again.");
    const helcimFee = Number((row.meta as Record<string, string>).cardFeeCents ?? 0) || 0;
    if (kind === "deposit") return { kind, provider: "helcim", accountId: "", paymentIntentId: row.id, providerPaymentId: row.transactionId, cents: row.amountCents - helcimFee, surchargeCents: helcimFee, cardLabel: row.cardLabel, meta };
    return { kind, provider: "helcim", setupIntentId: row.id, meta };
  }
  const accountId = pay.accountId;
  if (!accountId) throw new BookingError("Online payments are not set up.");
  if (kind === "deposit") {
    const pi = await stripe().paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: accountId });
    const meta = check(pi.metadata);
    if (pi.status !== "succeeded") throw new BookingError(`Your card was not charged (${pi.status.replace(/_/g, " ")}). Please try again.`);
    const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
    // The sweep refunds a deposit whose booking never finished; a page that comes back after that must not book on refunded money.
    if (charge && (charge.refunded || charge.amount_refunded > 0)) throw new BookingError("This deposit was refunded because the booking wasn't finished in time. Please book again.");
    const card = charge?.payment_method_details?.card;
    const cardFee = Math.min(pi.amount, Number(pi.metadata.cardFeeCents ?? 0) || 0);
    return { kind, accountId, paymentIntentId: pi.id, cents: pi.amount - cardFee, surchargeCents: cardFee, cardLabel: card ? `${card.brand?.toUpperCase() ?? "CARD"} •••• ${card.last4 ?? ""}` : null, meta };
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
  const prep = await withTenant(input.businessId, async (tx) => {
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId)).for("update");
    if (!appt || appt.depositStatus !== "paid" || !appt.depositPaymentIntentId) return false;
    const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { depositRefundAs: true } });
    const refundCents = Math.min(appt.depositCents, Math.max(1, Math.round(input.amountCents ?? appt.depositCents)));
    const partial = refundCents < appt.depositCents;
    // A card fee charged with the deposit goes back in proportion (all of it with the whole deposit).
    const feeBack = partial ? Math.min(appt.depositSurchargeCents, Math.round((appt.depositSurchargeCents * refundCents) / appt.depositCents)) : appt.depositSurchargeCents;
    const after = partial ? { depositCents: appt.depositCents - refundCents, depositSurchargeCents: appt.depositSurchargeCents - feeBack } : { depositStatus: "refunded" as const };
    const as = input.as ?? (biz?.depositRefundAs === "store_credit" ? "store_credit" : "original");
    // Under a store-credit policy the money stays on the account and the client gets a balance instead.
    if (as === "store_credit" && appt.clientId) {
      await changeStoreCredit(tx, { businessId: input.businessId, clientId: appt.clientId, deltaCents: refundCents + feeBack, surchargeCents: feeBack, reason: "deposit_refund", appointmentId: appt.id, note: input.reason, actorUserId: input.actorUserId });
      await tx.update(schema.appointments).set(after).where(eq(schema.appointments.id, appt.id));
      await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "deposit.store_credit", entity: "appointment", entityId: appt.id, diff: JSON.stringify({ cents: refundCents, kept: appt.depositCents - refundCents, reason: input.reason }) });
      return true;
    }
    if (appt.depositProvider === "helcim") {
      const business = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId) });
      const token = business ? helcimTokenOf({ ...business, paymentProvider: "helcim" }) : null;
      if (!token || !appt.depositProviderPaymentId) throw new BookingError("Helcim isn't connected. Refund the deposit in your Helcim dashboard.");
      return { appt, refundCents, feeBack, after, partial, account: "", helcimToken: token };
    }
    // Back through the account that took the deposit (the location may have switched accounts since).
    const account = appt.depositStripeAccountId ?? input.accountId;
    if (!account) throw new BookingError("Stripe account not connected.");
    return { appt, refundCents, feeBack, after, partial, account, helcimToken: null as string | null };
  });
  if (typeof prep === "boolean") return prep;
  const { appt, refundCents, feeBack, after, partial, account, helcimToken } = prep;
  if (helcimToken) {
    await refundHelcimTransaction(helcimToken, { key: `deposit_refund_${appt.id}_${appt.depositCents}_${partial ? refundCents : "all"}`, transactionId: appt.depositProviderPaymentId!, amountCents: refundCents + feeBack, full: !partial });
  } else
  // Stripe is called with no transaction open. A partial refund names its amount; a full one lets Stripe refund what is left. The key
  // carries the deposit as it stood, so a double click is one refund but a second, equal partial refund later is a refund of its own.
  await stripe().refunds.create({ payment_intent: appt.depositPaymentIntentId!, ...(partial ? { amount: refundCents + feeBack } : {}), metadata: { appointmentId: appt.id, reason: input.reason } }, { stripeAccount: account, idempotencyKey: `deposit_refund_${appt.id}_${appt.depositCents}_${partial ? refundCents : "all"}` });
  return withTenant(input.businessId, async (tx) => {
    // Only if nothing recorded it meanwhile (a double click, or the webhook for this very refund): then the deposit has already moved on.
    const updated = await tx
      .update(schema.appointments)
      // After a partial refund the deposit is what the salon kept; it stays "paid" so it can still be applied to the visit's bill or the fee.
      .set(after)
      .where(and(eq(schema.appointments.id, appt.id), eq(schema.appointments.depositStatus, "paid"), eq(schema.appointments.depositCents, appt.depositCents)))
      .returning({ id: schema.appointments.id });
    if (updated.length) await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: "deposit.refund", entity: "appointment", entityId: appt.id, diff: JSON.stringify({ cents: refundCents, kept: appt.depositCents - refundCents, reason: input.reason }) });
    return true;
  });
}

/** Refund a PaymentIntent that never became an appointment (slot taken after the charge). */
export async function refundOrphanIntent(accountId: string, paymentIntentId: string) {
  await stripe().refunds.create({ payment_intent: paymentIntentId, metadata: { reason: "booking_failed" } }, { stripeAccount: accountId, idempotencyKey: `orphan_refund_${paymentIntentId}` });
}

/**
 * Deposits that were charged but never became an appointment: the client's phone lost signal or the tab closed between Stripe confirming
 * the card and the booking being saved. Each deposit PaymentIntent that succeeded (from the webhook ledger) is checked once it is 20
 * minutes old; with no appointment holding it, it is refunded in full and the business's activity log says so. Run by the 5-minute job.
 */
export async function sweepOrphanDeposits(): Promise<{ checked: number; refunded: number; failed: number }> {
  const rows = (await db.execute(sql`
    select id, account_id as "accountId",
      payload->'data'->'object'->>'id' as "paymentIntentId",
      payload->'data'->'object'->>'amount' as "amount",
      payload->'data'->'object'->'metadata'->>'businessId' as "businessId"
    from webhook_events
    where type = 'payment_intent.succeeded' and followed_up_at is null
      and payload->'data'->'object'->'metadata'->>'kind' = 'deposit'
      and received_at < now() - interval '20 minutes' and received_at > now() - interval '7 days'
    order by received_at
    limit 50
  `)) as unknown as { id: string; accountId: string | null; paymentIntentId: string | null; amount: string | null; businessId: string | null }[];
  let refunded = 0;
  let failed = 0;
  for (const r of rows) {
    const done = () => db.update(schema.webhookEvents).set({ followedUpAt: new Date() }).where(eq(schema.webhookEvents.id, r.id));
    if (!r.businessId || !r.accountId || !r.paymentIntentId) {
      await done();
      continue;
    }
    const appt = await appointmentForIntent(r.businessId, r.paymentIntentId);
    if (appt) {
      await done();
      continue;
    }
    try {
      await refundOrphanIntent(r.accountId, r.paymentIntentId);
    } catch (e) {
      // Already refunded (the booking step refunded it itself when the slot was gone): nothing left to do.
      if ((e as { code?: string }).code !== "charge_already_refunded") {
        failed++;
        console.error("[deposits] orphan refund failed", r.paymentIntentId, (e as Error).message);
        continue;
      }
    }
    await withTenant(r.businessId, (tx) =>
      tx.insert(schema.auditLog).values({ businessId: r.businessId!, actorUserId: null, action: "deposit.orphan_refund", entity: "payment_intent", entityId: r.paymentIntentId, diff: JSON.stringify({ cents: Number(r.amount ?? 0), why: "The card was charged but the booking was never completed, so the deposit was refunded." }) }),
    );
    await done();
    refunded++;
  }
  return { checked: rows.length, refunded, failed };
}
