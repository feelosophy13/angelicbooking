/**
 * Platform pricing as billing sees it, derived from the price book (platform_pricing / business_pricing in the
 * database, edited in the admin app). Pure (no Stripe import) so it can be unit tested and used in client-safe code.
 */
import type { PriceBook } from "@angelic/core/platform-pricing";

export interface BillingConfig {
  /** Flat monthly platform fee per business, in cents. 0 = free base plan (card still collected for add-ons). */
  baseCents: number;
  /** Monthly fee for a dedicated toll-free text number, in cents. */
  numberCents: number;
  /** Price per text message sent, in cents, after the included allowance. */
  smsUsageCents: number;
  /** Text messages included each month before usage pricing applies. */
  smsIncluded: number;
  /** Free trial length for the base plan, in days. 0 = none. */
  trialDays: number;
}

export function configFromBook(book: PriceBook): BillingConfig {
  return { baseCents: book.baseCents, numberCents: book.numberCents, smsUsageCents: book.smsUsageCents, smsIncluded: book.smsIncluded, trialDays: book.trialDays };
}

/** Every number-fee price's lookup key starts with this, whatever the amount. */
export const NUMBER_KEY_PREFIX = "angelic_sms_number_monthly_";

/** Stripe price lookup keys encode the amounts, so changing a price in the price book creates a new Stripe price automatically. */
export function lookupKeys(c: BillingConfig) {
  return {
    base: `angelic_base_monthly_${c.baseCents}`,
    number: `${NUMBER_KEY_PREFIX}${c.numberCents}`,
    usage: `angelic_sms_usage_${c.smsUsageCents}_incl_${c.smsIncluded}`,
  };
}

export const SMS_METER_EVENT = "sms_sent";

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "paused";

/** A subscription that can be charged (card on file, not cancelled). */
export function isSubscribed(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/** Billing needs attention: Stripe could not collect the last invoice. */
export function isDelinquent(status: string): boolean {
  return status === "past_due" || status === "unpaid";
}

/**
 * Whether a business may buy a text number. Anything that would cost money
 * needs a subscription with a card; a fully free configuration needs nothing.
 */
export function canBuyNumber(opts: { billingEnabled: boolean; status: string; config: BillingConfig }): boolean {
  const costsMoney = opts.config.numberCents > 0 || opts.config.smsUsageCents > 0;
  if (!costsMoney || !opts.billingEnabled) return true;
  return opts.status === "active" || opts.status === "trialing";
}

/**
 * Why a business's texts are paused, or null when they may go out. Every text costs us money and is billed on the
 * subscription, so a business that has no active or trialing subscription does not send texts (emails are unaffected).
 * Not paused: billing is not set up on the platform (nothing can be charged anywhere), the business is comped, or a text
 * is priced at $0.
 */
export function smsPausedReason(opts: { billingEnabled: boolean; comped: boolean; status: string; smsUsageCents: number }): string | null {
  if (!opts.billingEnabled || opts.comped || opts.smsUsageCents <= 0) return null;
  if (opts.status === "active" || opts.status === "trialing") return null;
  return "Texts are paused until a subscription is active. Add a card under Settings → Billing.";
}
