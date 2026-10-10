/**
 * Passwordless sign-in for clients on the booking site: a 6-digit code sent to
 * the email or mobile number already on their record. Codes expire after ten
 * minutes and allow five attempts.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { queueOneOff } from "@/lib/notify";
import { emailConfigured } from "@/lib/notify/providers";
import { getActiveNumber } from "./messaging";
import { getClientSessionId } from "@/lib/client-session";
import { customerIdFor, savedCardsFor } from "./stripe-connect";
import { paymentContextFor } from "./locations";
import { stripe } from "@/lib/stripe";
import { pointsBalance, ensureReferralCode } from "./loyalty";
import type { PublicBusiness } from "./public-booking";

export class ClientAuthError extends Error {}

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function hashCode(businessId: string, code: string): string {
  return createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? ""}:${businessId}:${code}`).digest("hex");
}

/** Where a sign-in code can go for a typed email/phone. Generic result so the form never reveals who is a client. */
export async function requestLoginCode(business: PublicBusiness, typed: string): Promise<{ channel: "email" | "sms" | "none" }> {
  const phone = normalizePhone(typed);
  const email = typed.includes("@") ? typed.trim().toLowerCase() : null;
  if (!phone && !email) throw new ClientAuthError("Enter the email or mobile number you book with.");
  const client = await withTenant(business.id, (tx) =>
    tx.query.clients.findFirst({ where: or(phone ? eq(schema.clients.phone, phone) : sql`false`, email ? sql`lower(${schema.clients.email}) = ${email}` : sql`false`) }),
  );
  if (!client) return { channel: "none" };
  const channel: "email" | "sms" = email ? "email" : "sms";
  if (channel === "sms") {
    const number = await getActiveNumber(business.id);
    if (number?.status !== "verified" && !process.env.TWILIO_FROM && !process.env.TWILIO_MESSAGING_SERVICE_SID) {
      // No way to text yet: fall back to the client's email when we have one.
      if (!client.email) throw new ClientAuthError("Texting isn't available yet. Sign in with your email address instead.");
      return requestLoginCode(business, client.email);
    }
  } else if (!emailConfigured() && process.env.NODE_ENV === "production") {
    throw new ClientAuthError("Email sign-in isn't available right now. Please try again later.");
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  if (!emailConfigured() && process.env.NODE_ENV !== "production") console.log(`[client-login] code for ${client.firstName} (${channel === "email" ? email : phone}): ${code}`);
  await withTenant(business.id, (tx) =>
    tx.insert(schema.clientLoginCodes).values({ businessId: business.id, clientId: client.id, channel, destination: channel === "email" ? email! : phone!, codeHash: hashCode(business.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) }),
  );
  if (channel === "email") {
    await queueOneOff(business.id, {
      channel: "email",
      template: "client_login",
      recipient: email!,
      subject: `${code} is your ${business.name} sign-in code`,
      body: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:24px;color:#1c1917"><p>Your sign-in code for ${business.name}:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#78716c;font-size:13px">It expires in 10 minutes. If you didn't request it, ignore this email.</p></body></html>`,
    });
  } else {
    await queueOneOff(business.id, { channel: "sms", template: "client_login", recipient: phone!, body: `${business.name}: your sign-in code is ${code}. It expires in 10 minutes.` });
  }
  return { channel };
}

/** Check the code and return the client id to sign in. */
export async function verifyLoginCode(business: PublicBusiness, typed: string, code: string): Promise<string> {
  const phone = normalizePhone(typed);
  const email = typed.includes("@") ? typed.trim().toLowerCase() : null;
  const destination = email ?? phone;
  if (!destination || !/^\d{6}$/.test(code)) throw new ClientAuthError("Enter the 6-digit code.");
  return withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: or(phone ? eq(schema.clients.phone, phone) : sql`false`, email ? sql`lower(${schema.clients.email}) = ${email}` : sql`false`) });
    if (!client) throw new ClientAuthError("That code isn't right. Request a new one.");
    const row = await tx.query.clientLoginCodes.findFirst({ where: and(eq(schema.clientLoginCodes.clientId, client.id), isNull(schema.clientLoginCodes.consumedAt)), orderBy: desc(schema.clientLoginCodes.createdAt) });
    if (!row || row.expiresAt < new Date()) throw new ClientAuthError("That code has expired. Request a new one.");
    if (row.attempts >= MAX_ATTEMPTS) throw new ClientAuthError("Too many attempts. Request a new code.");
    if (row.codeHash !== hashCode(business.id, code)) {
      await tx.update(schema.clientLoginCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.clientLoginCodes.id, row.id));
      throw new ClientAuthError("That code isn't right.");
    }
    await tx.update(schema.clientLoginCodes).set({ consumedAt: new Date() }).where(eq(schema.clientLoginCodes.id, row.id));
    await tx.update(schema.clients).set({ lastLoginAt: new Date() }).where(eq(schema.clients.id, client.id));
    return client.id;
  });
}

/** The signed-in client (row) for this business, or null. */
export async function currentClient(business: PublicBusiness) {
  const id = await getClientSessionId(business.id);
  if (!id) return null;
  return (await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, id) }))) ?? null;
}

/** Everything the account page shows. */
export async function clientAccountData(business: PublicBusiness, clientId: string) {
  const data = await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    if (!client) return null;
    const now = new Date();
    const visits = await tx
      .select({ id: schema.appointments.id, status: schema.appointments.status, manageToken: schema.appointments.manageToken, startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, serviceId: schema.appointmentItems.serviceId, staffId: schema.appointmentItems.staffId, staffName: schema.staff.displayName, classSessionId: schema.appointmentItems.classSessionId })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointmentItems.sortOrder, 0)))
      .orderBy(desc(schema.appointmentItems.startAt))
      .limit(60);
    const packs = await tx
      .select({ id: schema.clientPackages.id, name: schema.packages.name, remaining: schema.clientPackages.remaining, expiresAt: schema.clientPackages.expiresAt })
      .from(schema.clientPackages)
      .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
      .where(and(eq(schema.clientPackages.clientId, clientId), gt(schema.clientPackages.remaining, 0), or(isNull(schema.clientPackages.expiresAt), gt(schema.clientPackages.expiresAt, now))));
    const memberships = await tx
      .select({ id: schema.clientMemberships.id, name: schema.membershipPlans.name, status: schema.clientMemberships.status, creditsRemaining: schema.clientMemberships.creditsRemaining, currentPeriodEnd: schema.clientMemberships.currentPeriodEnd })
      .from(schema.clientMemberships)
      .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
      .where(and(eq(schema.clientMemberships.clientId, clientId), eq(schema.clientMemberships.status, "active")));
    const points = business.loyaltyEnabled ? await pointsBalance(tx, clientId) : 0;
    const referralCode = business.loyaltyEnabled && (business.referralBonusPoints > 0 || business.referralFriendBonusPoints > 0) ? await ensureReferralCode(tx, client) : null;
    const giftCards = await tx.select({ code: schema.giftCards.code, balanceCents: schema.giftCards.balanceCents }).from(schema.giftCards).where(and(eq(schema.giftCards.purchaserClientId, clientId), gt(schema.giftCards.balanceCents, 0), eq(schema.giftCards.active, true)));
    return { client, visits, packs, memberships, points, referralCode, giftCards };
  });
  if (!data) return null;
  // Cards live on the client's home location's account (else the default site's).
  const pay = await paymentContextFor(business, data.client.homeLocationId);
  const cards = await savedCardsFor(business.id, pay, clientId);
  const done = new Set(["cancelled", "completed", "no_show"]);
  return {
    ...data,
    cards,
    upcoming: data.visits.filter((v) => v.startAt >= new Date() && !done.has(v.status)).reverse(),
    past: data.visits.filter((v) => v.startAt < new Date() || done.has(v.status)),
  };
}

/** Remove a saved card, after checking it belongs to this client's Stripe customer. */
export async function removeSavedCard(business: PublicBusiness, clientId: string, paymentMethodId: string) {
  const client = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
  if (!client) throw new ClientAuthError("No saved cards.");
  const pay = await paymentContextFor(business, client.homeLocationId);
  const customerId = pay.accountId ? await withTenant(business.id, (tx) => customerIdFor(tx, clientId, pay.accountId)) : null;
  if (!customerId || !pay.accountId) throw new ClientAuthError("No saved cards.");
  const pm = await stripe().paymentMethods.retrieve(paymentMethodId, {}, { stripeAccount: pay.accountId });
  if ((typeof pm.customer === "string" ? pm.customer : pm.customer?.id) !== customerId) throw new ClientAuthError("That card isn't yours.");
  await stripe().paymentMethods.detach(paymentMethodId, {}, { stripeAccount: pay.accountId });
}

export async function updateClientProfile(business: PublicBusiness, clientId: string, input: { firstName: string; lastName: string; email: string | null; phone: string | null; birthday: string | null; smsOptIn: boolean; emailOptIn: boolean }) {
  await withTenant(business.id, (tx) => tx.update(schema.clients).set(input).where(eq(schema.clients.id, clientId)));
}
