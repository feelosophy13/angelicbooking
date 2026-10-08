"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { BookingError } from "@/server/booking";
import { cancelOnline, createOnlineBooking, getPublicBusiness, joinWaitlist, rescheduleOnline } from "@/server/public-booking";

export type PublicState = { error?: string; ok?: boolean } | undefined;

const contact = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().max(60).default(""),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => v || null),
  notes: z.string().trim().max(1000).transform((v) => v || null),
  smsConsent: z.string().optional().transform((v) => v === "on"),
});

export async function bookOnline(_prev: PublicState, formData: FormData): Promise<PublicState> {
  const parsed = contact
    .extend({ slug: z.string(), serviceId: z.string().min(1), staffId: z.string().min(1), startAt: z.string().datetime() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.email && !d.phone) return { error: "Enter an email or a mobile number so we can confirm your booking." };
  if (d.phone && !normalizePhone(d.phone)) return { error: "Enter a valid mobile number." };
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  let token: string;
  try {
    const r = await createOnlineBooking(business, { ...d, startAt: new Date(d.startAt) });
    token = r.token;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  redirect(`/book/${d.slug}/confirmed/${token}`);
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
    .extend({ slug: z.string(), serviceId: z.string().min(1), staffId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const d = parsed.data;
  if (!d.email && !d.phone) return { error: "Enter an email or mobile number so we can reach you." };
  const business = await getPublicBusiness(d.slug);
  if (!business) return { error: "Online booking is not available." };
  await joinWaitlist(business, { ...d, staffId: d.staffId && d.staffId !== "any" ? d.staffId : null });
  return { ok: true };
}
