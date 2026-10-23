/**
 * Card surcharge / convenience fee: an opt-in per business (Settings → Checkout & tips). All amounts are integer cents.
 *
 * The fee is worked out on the part of the bill paid by card ("base"), added on top of it, and kept as its own ticket line tied to that
 * payment. It is never discounted, taxed, commissioned or split into tips, and a refund of part of the payment gives back the same share
 * of the fee.
 */

export type CardFeeType = "off" | "surcharge" | "convenience";
/** Where the card is taken: at the desk (typed, saved, reader), an online booking deposit, or the online store. */
export type CardFeeChannel = "desk" | "online" | "store";
/** What the processor says the card is. "unknown" = it can't tell before charging (Helcim). */
export type CardFunding = "credit" | "debit" | "prepaid" | "unknown";

export interface CardFeeSettings {
  type: CardFeeType;
  /** Surcharge, in basis points (300 = 3%). */
  bps: number;
  /** Convenience fee, flat. */
  cents: number;
  desk: boolean;
  online: boolean;
  store: boolean;
  /** No fee on debit and prepaid cards (card brand rules forbid surcharging them). */
  debitExempt: boolean;
}

/** Card brands cap a US surcharge at 3% (and at the salon's own cost of acceptance, which may be lower). */
export const MAX_SURCHARGE_BPS = 300;
/** A sanity cap on a flat convenience fee. */
export const MAX_CONVENIENCE_CENTS = 10_000;

export const NO_CARD_FEE: CardFeeSettings = { type: "off", bps: 0, cents: 0, desk: false, online: false, store: false, debitExempt: true };

/** The settings off a businesses row. */
export function cardFeeSettingsOf(b: { cardFeeType: string; cardFeeBps: number; cardFeeCents: number; cardFeeDesk: boolean; cardFeeOnline: boolean; cardFeeStore: boolean; cardFeeDebitExempt: boolean }): CardFeeSettings {
  const type: CardFeeType = b.cardFeeType === "surcharge" || b.cardFeeType === "convenience" ? b.cardFeeType : "off";
  return { type, bps: Math.min(MAX_SURCHARGE_BPS, Math.max(0, b.cardFeeBps)), cents: Math.min(MAX_CONVENIENCE_CENTS, Math.max(0, b.cardFeeCents)), desk: b.cardFeeDesk, online: b.cardFeeOnline, store: b.cardFeeStore, debitExempt: b.cardFeeDebitExempt };
}

/** Whether a fee is set up for this channel at all (before knowing the card). */
export function cardFeeOn(s: CardFeeSettings, channel: CardFeeChannel): boolean {
  if (s.type === "off" || !s[channel]) return false;
  return s.type === "surcharge" ? s.bps > 0 : s.cents > 0;
}

/**
 * The fee on `baseCents` paid by card. Debit and prepaid cards pay none when the salon exempts them, and neither does a card the processor
 * can't identify ("unknown"): charging a debit card a surcharge breaks the card brands' rules, so when in doubt there is no fee.
 */
export function cardFeeFor(s: CardFeeSettings, channel: CardFeeChannel, baseCents: number, funding: CardFunding): number {
  if (!cardFeeOn(s, channel) || !Number.isFinite(baseCents) || baseCents <= 0) return 0;
  if (s.debitExempt && funding !== "credit") return 0;
  return s.type === "surcharge" ? Math.round((baseCents * Math.min(MAX_SURCHARGE_BPS, s.bps)) / 10_000) : s.cents;
}

/** Stripe's card.funding ("credit" | "debit" | "prepaid" | "unknown") as ours. */
export function fundingOf(raw: string | null | undefined): CardFunding {
  return raw === "credit" || raw === "debit" || raw === "prepaid" ? raw : "unknown";
}

/** "3%" or "$2.00". */
function amountText(s: CardFeeSettings, money: (cents: number) => string): string {
  return s.type === "surcharge" ? `${(s.bps / 100).toFixed(s.bps % 100 === 0 ? 0 : 2).replace(/\.?0+$/, "")}%` : money(s.cents);
}

/** The ticket and receipt line: "Card surcharge (3%)" or "Convenience fee". */
export function cardFeeLineName(s: CardFeeSettings, money: (cents: number) => string): string {
  return s.type === "surcharge" ? `Card surcharge (${amountText(s, money)})` : "Convenience fee";
}

/**
 * What the client is told before paying: "A 3% card fee applies. Pay cash to avoid it. Debit cards: no fee." `cashOption` is false online,
 * where a card is the only way to pay.
 */
export function cardFeeNotice(s: CardFeeSettings, money: (cents: number) => string, opts: { cashOption: boolean }): string {
  const what = s.type === "surcharge" ? `A ${amountText(s, money)} card fee applies` : `A ${amountText(s, money)} convenience fee applies to card payments`;
  return `${what}.${opts.cashOption ? " Pay cash to avoid it." : ""}${s.debitExempt ? " Debit cards: no fee." : ""}`;
}

/** A card payment as refunds see it: the gross amount (fee included), its fee, and what of each has already gone back. */
export interface FeePayment {
  amountCents: number;
  surchargeCents: number;
  /** Refunded plus given back as store credit, fee included. */
  returnedCents: number;
  surchargeReturnedCents: number;
}

/**
 * The share of the fee that goes back with a refund of `baseCents` of what the client paid for (not counting the fee): the remaining fee
 * in proportion to the remaining base, and all of it once the whole base is refunded, so partial refunds add up to the fee exactly.
 */
export function cardFeeRefundPart(p: FeePayment, baseCents: number): number {
  const feeLeft = p.surchargeCents - p.surchargeReturnedCents;
  if (feeLeft <= 0 || baseCents <= 0) return 0;
  const baseLeft = p.amountCents - p.surchargeCents - (p.returnedCents - p.surchargeReturnedCents);
  if (baseLeft <= 0 || baseCents >= baseLeft) return feeLeft;
  return Math.min(feeLeft, Math.round((feeLeft * baseCents) / baseLeft));
}

/** A gross amount refunded outside the app (Stripe's dashboard), split into the base and the fee in the same proportion. */
export function splitGrossRefund(p: FeePayment, grossCents: number): { baseCents: number; feeCents: number } {
  const feeLeft = p.surchargeCents - p.surchargeReturnedCents;
  const left = p.amountCents - p.returnedCents;
  if (feeLeft <= 0 || grossCents <= 0 || left <= 0) return { baseCents: Math.max(0, grossCents), feeCents: 0 };
  const feeCents = grossCents >= left ? feeLeft : Math.min(feeLeft, Math.round((feeLeft * grossCents) / left));
  return { baseCents: grossCents - feeCents, feeCents };
}

/** The rules a salon must follow to add a card fee in the US. Shown in Settings; not legal advice, and not a promise of compliance. */
export const CARD_FEE_RULES: string[] = [
  "Some states ban credit card surcharges (at the time of writing: Connecticut, Massachusetts, Maine and Puerto Rico) and others cap them or require the card price to be shown up front (for example California, Colorado, New Jersey and New York). Laws change often: check your state's and city's current rules before you turn this on.",
  "Tell Visa and Mastercard (and your processor) at least 30 days before you start surcharging; Stripe and Helcim can tell you how.",
  "A surcharge may not be more than 3%, or more than what card processing actually costs you, whichever is lower.",
  "Debit and prepaid cards may not be surcharged, even when run as credit. Keep “Debit cards: no fee” on.",
  "Post a notice at the entrance and at the desk, show the fee before the client pays, and print it as its own line on the receipt. The app does the last two.",
  "A convenience fee is a different thing: flat, only for paying in a channel other than your usual one (for example online), and not allowed by some card brands for in-person payments.",
  "In some states the fee is subject to sales tax. The app does not tax it; ask your accountant.",
];
