import { cardFeeFor, cardFeeNotice, type CardFeeChannel, type CardFeeSettings } from "@angelic/core";
import { formatMoney } from "./utils";

/** What the client sees about a card fee before paying `baseCents` by card, or null when there is none to show. */
export type CardFeeQuote = {
  /** "A 3% card fee applies. Debit cards: no fee." */
  notice: string;
  /** The fee on a credit card (the most it can be). */
  estimateCents: number;
  /** Debit cards pay no fee, so the final amount may be lower. */
  debitExempt: boolean;
};

/**
 * The fee quote for a payment page. Stripe tells debit from credit once the card is entered, so the quote is the credit card fee; Helcim
 * can't, so with debit exempt there is no fee at all on Helcim and nothing to show.
 */
export function cardFeeQuote(settings: CardFeeSettings, provider: "stripe" | "helcim", channel: CardFeeChannel, baseCents: number, currency: string, opts: { cashOption: boolean }): CardFeeQuote | null {
  const estimateCents = cardFeeFor(settings, channel, baseCents, provider === "helcim" ? "unknown" : "credit");
  if (estimateCents <= 0) return null;
  const s = provider === "helcim" ? { ...settings, debitExempt: false } : settings;
  return { notice: cardFeeNotice(s, (c) => formatMoney(c, currency), opts), estimateCents, debitExempt: s.debitExempt };
}
