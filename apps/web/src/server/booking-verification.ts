/**
 * Verify the client's phone (or email) before an online booking: a 6-digit code to the mobile number typed on the form, or to the email
 * when texting isn't set up or the client asks. Proving it yields a signed token (lib/client-session.ts) the form sends with the booking,
 * and lets the booking attach to the client who owns that number even when the name is typed differently. Codes expire after ten
 * minutes and allow five attempts; sends and guesses are rate-limited per destination like sign-in codes.
 */
import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { queueOneOff } from "@/lib/notify";
import { emailConfigured } from "@/lib/notify/providers";
import { sharedRateLimit } from "@/lib/shared-rate-limit";
import { decodeVerifiedContact, encodeVerifiedContact, getClientSessionId } from "@/lib/client-session";
import { getActiveNumber } from "./messaging";
import type { PublicBusiness } from "./public-booking";

export class VerificationError extends Error {}

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60_000;

const hashCode = (businessId: string, code: string) => createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? ""}:booking:${businessId}:${code}`).digest("hex");
const normEmail = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : null);

async function canText(businessId: string) {
  const number = await getActiveNumber(businessId);
  return number?.status === "verified" || !!process.env.TWILIO_FROM || !!process.env.TWILIO_MESSAGING_SERVICE_SID;
}

/** "(•••) •••-1234" / "j•••@gmail.com": where the code went, without spelling it out. */
export function maskDestination(destination: string): string {
  if (destination.includes("@")) {
    const [user, domain] = destination.split("@");
    return `${user!.slice(0, 1)}•••@${domain}`;
  }
  return `(•••) •••-${destination.slice(-4)}`;
}

/** Is this booking already proven: a signed-in client, or the phone or email verified on this browser? */
export async function contactVerified(business: PublicBusiness, input: { phone: string | null; email: string | null }, token?: string | null): Promise<{ ok: boolean; via: "session" | "sms" | "email" | null }> {
  if (await getClientSessionId(business.id)) return { ok: true, via: "session" };
  const proven = decodeVerifiedContact(token, business.id);
  if (!proven) return { ok: false, via: null };
  const phone = normalizePhone(input.phone ?? "");
  if (phone && proven === phone) return { ok: true, via: "sms" };
  if (input.email && proven === normEmail(input.email)) return { ok: true, via: "email" };
  return { ok: false, via: null };
}

/** Whether this business asks for a code, and if so whether this booking still needs one. */
export async function verificationNeeded(business: PublicBusiness, input: { phone: string | null; email: string | null }, token?: string | null): Promise<boolean> {
  if (!business.verifyBookingContact) return false;
  return !(await contactVerified(business, input, token)).ok;
}

/**
 * Send a booking code. The phone is used when the business can text; otherwise (or when the client asks) the email. Returns where it
 * went, masked, and the channel, so the form can offer the other one.
 */
export async function sendBookingCode(business: PublicBusiness, input: { phone: string | null; email: string | null; via?: "sms" | "email" }): Promise<{ channel: "sms" | "email"; to: string }> {
  const phone = normalizePhone(input.phone ?? "");
  const email = normEmail(input.email);
  const texting = !!phone && (await canText(business.id));
  const channel: "sms" | "email" = input.via === "email" || !texting ? "email" : "sms";
  const destination = channel === "sms" ? phone! : email;
  if (!destination) throw new VerificationError(phone ? "Texting isn't available here yet. Enter your email to get the code." : "Enter your mobile number or email.");
  if (channel === "email" && !emailConfigured() && process.env.NODE_ENV === "production") throw new VerificationError("We can't send the code right now. Please call to book.");
  if (!(await sharedRateLimit(`booking-code:${business.id}:${destination}`, 5, HOUR_MS)).ok) throw new VerificationError("Too many codes requested. Please try again in an hour.");
  const code = String(randomInt(100000, 1000000));
  if ((channel === "email" ? !emailConfigured() : !(await canText(business.id))) && process.env.NODE_ENV !== "production") console.log(`[booking-code] ${destination}: ${code}`);
  await withTenant(business.id, (tx) => tx.insert(schema.clientLoginCodes).values({ businessId: business.id, clientId: null, purpose: "booking", channel, destination, codeHash: hashCode(business.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) }));
  if (channel === "email") {
    await queueOneOff(business.id, {
      channel: "email",
      template: "booking_code",
      recipient: destination,
      subject: `${code} is your ${business.name} booking code`,
      body: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:24px;color:#1c1917"><p>Your code to confirm your booking with ${business.name}:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#78716c;font-size:13px">It expires in 10 minutes. If you didn't try to book, ignore this email.</p></body></html>`,
    });
  } else {
    await queueOneOff(business.id, { channel: "sms", template: "booking_code", recipient: destination, body: `${business.name}: your booking code is ${code}. It expires in 10 minutes.` });
  }
  return { channel, to: maskDestination(destination) };
}

/** Check a booking code for the phone or email it was sent to; returns the token that proves it to the booking request. */
export async function checkBookingCode(business: PublicBusiness, input: { phone: string | null; email: string | null; channel: "sms" | "email"; code: string }) {
  const destination = input.channel === "sms" ? normalizePhone(input.phone ?? "") : normEmail(input.email);
  const code = input.code.replace(/\D/g, "");
  if (!destination || !/^\d{6}$/.test(code)) throw new VerificationError("Enter the 6-digit code.");
  if (!(await sharedRateLimit(`booking-guess:${business.id}:${destination}`, 15, HOUR_MS)).ok) throw new VerificationError("Too many attempts. Please try again in an hour.");
  await withTenant(business.id, async (tx) => {
    const row = await tx.query.clientLoginCodes.findFirst({ where: and(eq(schema.clientLoginCodes.purpose, "booking"), eq(schema.clientLoginCodes.destination, destination), isNull(schema.clientLoginCodes.consumedAt)), orderBy: desc(schema.clientLoginCodes.createdAt) });
    if (!row || row.expiresAt < new Date()) throw new VerificationError("That code has expired. Send a new one.");
    if (row.attempts >= MAX_ATTEMPTS) throw new VerificationError("Too many attempts. Send a new code.");
    if (row.codeHash !== hashCode(business.id, code)) {
      await tx.update(schema.clientLoginCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.clientLoginCodes.id, row.id));
      throw new VerificationError("That code isn't right.");
    }
    await tx.update(schema.clientLoginCodes).set({ consumedAt: new Date() }).where(eq(schema.clientLoginCodes.id, row.id));
  });
  return encodeVerifiedContact(business.id, destination);
}
