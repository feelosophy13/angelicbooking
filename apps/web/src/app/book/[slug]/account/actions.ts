"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizePhone } from "@angelic/core";
import { getPublicBusiness } from "@/server/public-booking";
import { ClientAuthError, currentClient, removeSavedCard, requestLoginCode, updateClientProfile, verifyLoginCode } from "@/server/client-auth";
import { clearClientSession, setClientSession } from "@/lib/client-session";

export type AccountState = { error?: string; ok?: boolean; sent?: "email" | "sms"; destination?: string } | undefined;

export async function requestCode(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const d = z.object({ slug: z.string(), destination: z.string().trim().min(3).max(120) }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Enter the email or mobile number you book with." };
  const business = await getPublicBusiness(d.data.slug);
  if (!business || !business.clientAccountsEnabled) return { error: "Accounts aren't available." };
  try {
    const r = await requestLoginCode(business, d.data.destination);
    // Same response whether or not the contact is on file.
    return { sent: r.channel === "none" ? (d.data.destination.includes("@") ? "email" : "sms") : r.channel, destination: d.data.destination };
  } catch (e) {
    if (e instanceof ClientAuthError) return { error: e.message };
    throw e;
  }
}

export async function verifyCode(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const d = z.object({ slug: z.string(), destination: z.string().trim().min(3), code: z.string().trim() }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Enter the 6-digit code." };
  const business = await getPublicBusiness(d.data.slug);
  if (!business) return { error: "Accounts aren't available." };
  try {
    const clientId = await verifyLoginCode(business, d.data.destination, d.data.code.replace(/\D/g, ""));
    await setClientSession(business.id, business.slug, clientId);
  } catch (e) {
    if (e instanceof ClientAuthError) return { error: e.message, sent: d.data.destination.includes("@") ? "email" : "sms", destination: d.data.destination };
    throw e;
  }
  redirect(`/book/${business.slug}/account`);
}

export async function signOutClient(formData: FormData) {
  const slug = String(formData.get("slug"));
  const business = await getPublicBusiness(slug);
  if (business) await clearClientSession(business.id, business.slug);
  redirect(`/book/${slug}`);
}

export async function saveClientProfile(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const d = z
    .object({
      slug: z.string(),
      firstName: z.string().trim().min(1, "First name is required").max(60),
      lastName: z.string().trim().max(60).default(""),
      email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => v || null),
      phone: z.string().trim().max(30).transform((v) => v || null),
      birthday: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/).transform((v) => v || null),
      smsOptIn: z.string().optional().transform((v) => v === "on"),
      emailOptIn: z.string().optional().transform((v) => v === "on"),
      smsMarketingOptIn: z.string().optional().transform((v) => v === "on"),
      emailMarketingOptIn: z.string().optional().transform((v) => v === "on"),
    })
    .safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Check the form" };
  const business = await getPublicBusiness(d.data.slug);
  const client = business ? await currentClient(business) : null;
  if (!business || !client) return { error: "Please sign in again." };
  const phone = d.data.phone ? normalizePhone(d.data.phone) : null;
  if (!phone) return { error: d.data.phone ? "Enter a valid mobile number." : "A mobile number is required so we can reach you." };
  await updateClientProfile(business, client.id, { ...d.data, phone });
  return { ok: true };
}

export async function removeCard(formData: FormData) {
  const d = z.object({ slug: z.string(), paymentMethodId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const business = await getPublicBusiness(d.slug);
  const client = business ? await currentClient(business) : null;
  if (!business || !client) return;
  const kept = await removeSavedCard(business, client.id, d.paymentMethodId).then(
    () => false,
    (e) => e instanceof ClientAuthError && /holding an upcoming booking/.test(e.message),
  );
  redirect(`/book/${d.slug}/account?cards=1${kept ? "&card=in-use" : ""}`);
}
