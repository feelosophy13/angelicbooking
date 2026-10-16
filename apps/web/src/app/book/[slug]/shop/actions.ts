"use server";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { getPublicBusiness } from "@/server/public-booking";
import { finishOrder, orderKey, startOrder, StoreError } from "@/server/store";
import { BookingError } from "@/server/booking";

const buyer = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).default(""),
  email: z.string().trim().email("Enter a valid email so we can send your receipt"),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
});

export type StartOrderResult = { saleId: string; clientSecret: string; accountId: string | null; publishableKey: string | null; totalCents: number } | { error: string };

export async function startOrderAction(input: {
  slug: string;
  items: { productId: string; quantity: number }[];
  giftCard: { amountCents: number; recipientName: string; recipientEmail: string; message: string } | null;
  buyer: Record<string, string>;
  method: "pickup" | "ship";
  address: string;
  locationId?: string | null;
}): Promise<StartOrderResult> {
  const business = await getPublicBusiness(input.slug);
  if (!business || !business.storeEnabled) return { error: "The store isn't open right now." };
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
    return r;
  } catch (e) {
    if (e instanceof StoreError || e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

export async function finishOrderAction(slug: string, saleId: string, paymentIntentId: string): Promise<{ error?: string; ok?: boolean; key?: string }> {
  const business = await getPublicBusiness(slug);
  if (!business) return { error: "Not available." };
  try {
    await finishOrder(business, saleId, paymentIntentId);
    return { ok: true, key: orderKey(business.id, saleId) };
  } catch (e) {
    if (e instanceof StoreError) return { error: e.message };
    throw e;
  }
}
