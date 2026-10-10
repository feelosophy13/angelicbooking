/**
 * Platform pricing, read from env so it can change without a deploy of new code.
 * Pure (no Stripe import) so it can be unit tested and used in client-safe code.
 */
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

function int(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export function billingConfig(): BillingConfig {
  return {
    baseCents: int("BILLING_BASE_CENTS", 0),
    numberCents: int("SMS_NUMBER_MONTHLY_FEE_CENTS", 0),
    smsUsageCents: int("SMS_USAGE_CENTS", 0),
    smsIncluded: int("SMS_INCLUDED_PER_MONTH", 0),
    trialDays: int("BILLING_TRIAL_DAYS", 0),
  };
}

/** Stripe price lookup keys encode the amounts, so changing a price in env creates a new Stripe price automatically. */
export function lookupKeys(c: BillingConfig) {
  return {
    base: `angelic_base_monthly_${c.baseCents}`,
    number: `angelic_sms_number_monthly_${c.numberCents}`,
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
