"use server";
import { publicBotCheck } from "@/lib/turnstile";
import { z } from "zod";
import { cardFeeSettingsOf, normalizePhone } from "@angelic/core";
import { cardFeeQuote, type CardFeeQuote } from "@/lib/card-fee";
import { SaleError } from "@/server/sales";
import { getPublicBusiness } from "@/server/public-booking";
import { applyOrderCardFee, finishOrder, orderKey, startOrder, StoreError } from "@/server/store";
import { BookingError } from "@/server/booking";

const buyer = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).default(""),
  email: z.string().trim().email("Enter a valid email so we can send your receipt"),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
});

export type StartOrderResult =
  | { provider: "stripe"; saleId: string; clientSecret: string; accountId: string | null; publishableKey: string | null; totalCents: number; cardFee: CardFeeQuote | null }
  | { provider: "helcim"; saleId: string; checkoutToken: string; checkoutId: string; totalCents: number; cardFee: CardFeeQuote | null }
  | { error: string };

export async function startOrderAction(input: {
  slug: string;
  items: { productId: string; quantity: number }[];
  giftCard: { amountCents: number; recipientName: string; recipientEmail: string; message: string } | null;
  buyer: Record<string, string>;
  method: "pickup" | "ship";
  address: string;
  locationId?: string | null;
  /** The bot check's token from the checkout form. */
  botToken?: string | null;
}): Promise<StartOrderResult> {
  const bot = await publicBotCheck(input.botToken);
  if (bot) return { error: bot };
  const business = await getPublicBusiness(input.slug);
  if (!business) return { error: "The store isn't open right now." };
  // Products need the store; gift cards need online gift cards. Either can be on without the other.
  if (input.items.length && !business.storeEnabled) return { error: "The store isn't open right now." };
  if (input.giftCard && !business.giftCardsOnline) return { error: "Gift cards can't be bought online right now." };
  const b = buyer.safeParse(input.buyer);
  if (!b.success) return { error: b.error.issues[0]?.message ?? "Check your details" };
  if (b.data.phone && !normalizePhone(b.data.phone)) return { error: "Enter a valid mobile number." };
  const items = z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).max(30).safeParse(input.items);
  if (!items.success) return { error: "Check your cart." };
  const gift = input.giftCard
    ? { amountCents: Math.round(input.giftCard.amountCents), recipientName: input.giftCard.recipientName.trim().slice(0, 80) || null, recipientEmail: /\S+@\S+\.\S+/.test(input.giftCard.recipientEmail) ? input.giftCard.recipientEmail.trim() : null, message: input.giftCard.message.trim().slice(0, 300) || null }
    : null;
  try {
    const r = await startOrder(business, { items: items.data, giftCard: gift, buyer: { ...b.data, phone: b.data.phone ? normalizePhone(b.data.phone) : null }, fulfillment: { method: input.method, address: input.address.trim().slice(0, 300) || null } }, input.locationId || null);
    // The order total before any card fee; the fee is shown on its own line before paying.
    const cardFee = cardFeeQuote(cardFeeSettingsOf(business), r.provider, "store", r.totalCents, business.currency, { cashOption: false });
    if (r.provider === "helcim") return { provider: "helcim", saleId: r.saleId, checkoutToken: r.checkoutToken, checkoutId: r.checkoutId, totalCents: r.totalCents, cardFee };
    return { provider: "stripe", saleId: r.saleId, clientSecret: r.clientSecret, accountId: r.accountId, publishableKey: r.publishableKey, totalCents: r.totalCents, cardFee };
  } catch (e) {
    if (e instanceof StoreError || e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

export async function finishOrderAction(slug: string, saleId: string, paymentIntentId: string, /** Helcim: HelcimPay.js's answer (paymentIntentId is then the checkout id). */ helcimEvent?: unknown): Promise<{ error?: string; ok?: boolean; key?: string }> {
  const business = await getPublicBusiness(slug);
  if (!business) return { error: "Not available." };
  try {
    await finishOrder(business, saleId, paymentIntentId, helcimEvent);
    return { ok: true, key: orderKey(business.id, saleId) };
  } catch (e) {
    if (e instanceof StoreError) return { error: e.message };
    throw e;
  }
}

/** Stripe: the card is in; the store's card fee (if any) is added for it before the browser confirms. */
export async function applyOrderFeeAction(slug: string, saleId: string, paymentIntentId: string, paymentMethodId: string): Promise<{ error?: string }> {
  if (typeof saleId !== "string" || !/^pi_\w+$/.test(paymentIntentId) || !/^pm_\w+$/.test(paymentMethodId)) return { error: "That payment doesn't match this order." };
  const business = await getPublicBusiness(slug);
  if (!business) return { error: "Not available." };
  try {
    await applyOrderCardFee(business, saleId, paymentIntentId, paymentMethodId);
    return {};
  } catch (e) {
    if (e instanceof StoreError || e instanceof SaleError) return { error: e.message };
    throw e;
  }
}
