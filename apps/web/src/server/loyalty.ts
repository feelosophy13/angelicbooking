/**
 * Loyalty points and referrals. Points live in a ledger (balance = sum of
 * deltas). Clients earn on paid sales, redeem at checkout as a payment line,
 * and referrers are credited once their friend's first visit is paid.
 */
import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone } from "@angelic/core";
import { appUrl } from "@/lib/stripe";
import { queueOneOff } from "@/lib/notify";
import { brandedEmail } from "@/lib/notify/templates";

type Business = typeof schema.businesses.$inferSelect;

export class LoyaltyError extends Error {}

export async function pointsBalance(tx: TenantDb, clientId: string): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`coalesce(sum(${schema.loyaltyLedger.delta}), 0)` }).from(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.clientId, clientId));
  return Number(row?.n ?? 0);
}

export async function getClientLoyalty(businessId: string, clientId: string) {
  return withTenant(businessId, async (tx) => ({
    balance: await pointsBalance(tx, clientId),
    history: await tx.select().from(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.clientId, clientId)).orderBy(desc(schema.loyaltyLedger.createdAt)).limit(50),
  }));
}

/** Points earned for a paid sale: services + products after discount (no tips/tax), plus a per-visit bonus. */
export function pointsForSale(business: Business, sale: { subtotalCents: number; discountCents: number; tipCents: number }): number {
  if (!business.loyaltyEnabled) return 0;
  const spend = Math.max(0, sale.subtotalCents - sale.discountCents);
  return Math.floor((spend / 100) * Math.max(0, business.loyaltyPointsPerDollar)) + Math.max(0, business.loyaltyPointsPerVisit);
}

/**
 * Called inside the sale-closing transaction. Idempotent per (sale, reason)
 * thanks to the unique index. Also settles a pending referral reward.
 */
export async function awardPointsForSale(tx: TenantDb, business: Business, sale: typeof schema.sales.$inferSelect) {
  if (!business.loyaltyEnabled || !sale.clientId) return;
  const points = pointsForSale(business, sale);
  if (points > 0) {
    await tx
      .insert(schema.loyaltyLedger)
      .values({ businessId: business.id, clientId: sale.clientId, delta: points, reason: "earn", saleId: sale.id, note: `Sale #${sale.number}` })
      .onConflictDoNothing();
  }
  const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) });
  // Everyone who pays gets a code once referrals are on, so the receipt and automations can carry it.
  if (client && referralsEnabled(business) && !client.referralCode) await ensureReferralCode(tx, client).catch(() => null);
  if (client?.referredByClientId && !client.referralRewardedAt) {
    if (business.referralBonusPoints > 0) {
      await tx.insert(schema.loyaltyLedger).values({ businessId: business.id, clientId: client.referredByClientId, delta: business.referralBonusPoints, reason: "referral", saleId: sale.id, note: `Referred ${client.firstName} ${client.lastName}`.trim() }).onConflictDoNothing();
    }
    if (business.referralFriendBonusPoints > 0) {
      await tx.insert(schema.loyaltyLedger).values({ businessId: business.id, clientId: client.id, delta: business.referralFriendBonusPoints, reason: "referral_friend", saleId: sale.id, note: "Welcome bonus for joining through a friend" }).onConflictDoNothing();
    }
    await tx.update(schema.clients).set({ referralRewardedAt: new Date() }).where(eq(schema.clients.id, client.id));
  }
}

/** Redeem points against an open sale: a "loyalty" payment worth points × point value. */
export async function redeemPoints(input: { business: Business; saleId: string; points: number; actorUserId: string }) {
  const b = input.business;
  return withTenant(b.id, async (tx) => {
    if (!b.loyaltyEnabled) throw new LoyaltyError("Loyalty points are turned off.");
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale || sale.status !== "open") throw new LoyaltyError("Sale is not open.");
    if (!sale.clientId) throw new LoyaltyError("Attach a client to redeem points.");
    const balance = await pointsBalance(tx, sale.clientId);
    const due = sale.totalCents - sale.paidCents;
    const maxByDue = Math.floor(due / Math.max(1, b.loyaltyPointValueCents));
    const points = Math.min(Math.floor(input.points), balance, maxByDue);
    if (points < b.loyaltyMinRedeemPoints) throw new LoyaltyError(balance < b.loyaltyMinRedeemPoints ? `Needs at least ${b.loyaltyMinRedeemPoints} points (has ${balance}).` : `Redeem at least ${b.loyaltyMinRedeemPoints} points.`);
    if (points <= 0) throw new LoyaltyError("Nothing to redeem.");
    const amount = points * b.loyaltyPointValueCents;
    await tx.insert(schema.loyaltyLedger).values({ businessId: b.id, clientId: sale.clientId, delta: -points, reason: "redeem", saleId: sale.id, note: `Sale #${sale.number}`, createdByUserId: input.actorUserId });
    await tx.insert(schema.payments).values({ businessId: b.id, saleId: sale.id, method: "loyalty", status: "succeeded", amountCents: amount, tipCents: 0, note: `${points} points`, createdByUserId: input.actorUserId });
    await tx.insert(schema.auditLog).values({ businessId: b.id, actorUserId: input.actorUserId, action: "payment.loyalty", entity: "sale", entityId: sale.id, diff: JSON.stringify({ points, amount }) });
    return { points, amount };
  });
}

export async function adjustPoints(input: { businessId: string; clientId: string; delta: number; note: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const balance = await pointsBalance(tx, input.clientId);
    if (balance + input.delta < 0) throw new LoyaltyError(`Can't go below zero (balance ${balance}).`);
    await tx.insert(schema.loyaltyLedger).values({ businessId: input.businessId, clientId: input.clientId, delta: input.delta, reason: "adjust", note: input.note, createdByUserId: input.actorUserId });
  });
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The client's referral code, created on first use. */
export async function ensureReferralCode(tx: TenantDb, client: { id: string; firstName: string; referralCode: string | null; businessId: string }) {
  if (client.referralCode) return client.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    const code = `${client.firstName.replace(/[^a-z]/gi, "").slice(0, 6).toUpperCase() || "FRIEND"}-${[...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("")}`;
    const taken = await tx.query.clients.findFirst({ where: and(eq(schema.clients.businessId, client.businessId), eq(schema.clients.referralCode, code)) });
    if (!taken) {
      await tx.update(schema.clients).set({ referralCode: code }).where(eq(schema.clients.id, client.id));
      return code;
    }
  }
  throw new LoyaltyError("Could not generate a referral code.");
}

/** Resolve a typed referral code to the referring client (null if unknown). */
export async function findReferrer(tx: TenantDb, code: string | null | undefined) {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return null;
  return (await tx.query.clients.findFirst({ where: eq(schema.clients.referralCode, c) })) ?? null;
}

// ---------------------------------------------------------------------------
// Referrals: who brought whom, and getting the code into clients' hands
// ---------------------------------------------------------------------------

/** Referrals are "on" when the programme is enabled and either side earns something. */
export function referralsEnabled(b: Pick<Business, "loyaltyEnabled" | "referralBonusPoints" | "referralFriendBonusPoints">): boolean {
  return b.loyaltyEnabled && (b.referralBonusPoints > 0 || b.referralFriendBonusPoints > 0);
}

export interface ReferredClient {
  id: string;
  name: string;
  joinedAt: Date;
  /** First paid visit, which is when the bonus settles. */
  rewardedAt: Date | null;
}

/** Clients this person referred, newest first. */
export async function referralsOf(tx: TenantDb, clientId: string): Promise<ReferredClient[]> {
  const rows = await tx
    .select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, createdAt: schema.clients.createdAt, rewardedAt: schema.clients.referralRewardedAt })
    .from(schema.clients)
    .where(eq(schema.clients.referredByClientId, clientId))
    .orderBy(desc(schema.clients.createdAt));
  return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName ?? ""}`.trim(), joinedAt: r.createdAt, rewardedAt: r.rewardedAt }));
}

export interface ReferralRow {
  referrerId: string;
  referrerName: string;
  referredId: string;
  referredName: string;
  joinedAt: Date;
  rewardedAt: Date | null;
}

/** Every referral whose friend joined, or had their first paid visit, in the period (for Reports), newest first. */
export async function referralsInPeriod(tx: TenantDb, from: Date, to: Date): Promise<ReferralRow[]> {
  const referred = schema.clients;
  const inRange = (col: typeof referred.createdAt | typeof referred.referralRewardedAt) => and(gte(col, from), lt(col, to));
  const rows = await tx
    .select({ referrerId: referred.referredByClientId, referredId: referred.id, firstName: referred.firstName, lastName: referred.lastName, joinedAt: referred.createdAt, rewardedAt: referred.referralRewardedAt })
    .from(referred)
    .where(and(isNotNull(referred.referredByClientId), or(inRange(referred.createdAt), inRange(referred.referralRewardedAt))))
    .orderBy(desc(sql`coalesce(${referred.referralRewardedAt}, ${referred.createdAt})`));
  const referrerIds = [...new Set(rows.map((r) => r.referrerId!).filter(Boolean))];
  const referrers = referrerIds.length ? await tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName }).from(schema.clients).where(inArray(schema.clients.id, referrerIds)) : [];
  const nameOf = (id: string) => { const c = referrers.find((x) => x.id === id); return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : "Former client"; };
  return rows.map((r) => ({ referrerId: r.referrerId!, referrerName: nameOf(r.referrerId!), referredId: r.referredId, referredName: `${r.firstName} ${r.lastName ?? ""}`.trim(), joinedAt: r.joinedAt, rewardedAt: r.rewardedAt }));
}

/** The one-line pitch that goes with a code, used by texts, emails and receipts. */
export function referralPitch(b: Pick<Business, "name" | "referralBonusPoints" | "referralFriendBonusPoints">, code: string): string {
  const friend = b.referralFriendBonusPoints > 0 ? ` and they get ${b.referralFriendBonusPoints} points to start` : "";
  const you = b.referralBonusPoints > 0 ? `you earn ${b.referralBonusPoints} points after their first visit` : "we'll say thank you";
  return `Share your code ${code} with a friend: when they book at ${b.name} with it, ${you}${friend}.`;
}

/** Text or email the client their referral code (creating one if needed). Returns where it went. */
export async function sendReferralCode(business: Business, clientId: string, channel: "sms" | "email"): Promise<string> {
  const { code, client } = await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    if (!client) throw new LoyaltyError("Client not found.");
    return { code: await ensureReferralCode(tx, client), client };
  });
  const pitch = referralPitch(business, code);
  if (channel === "sms") {
    const phone = normalizePhone(client.phone);
    if (!phone) throw new LoyaltyError("No mobile number on file.");
    if (!client.smsOptIn) throw new LoyaltyError("This client has opted out of texts.");
    await queueOneOff(business.id, { channel: "sms", template: "referral_code", recipient: phone, body: `${business.name}: ${pitch} Book: ${appUrl(`/book/${business.slug}`)}`, clientId: client.id });
    return phone;
  }
  if (!client.email) throw new LoyaltyError("No email on file.");
  if (!client.emailOptIn) throw new LoyaltyError("This client has opted out of emails.");
  const html = brandedEmail(
    { businessName: business.name, logoUrl: business.logoUrl, brandColor: business.brandColor, businessPhone: business.phone, address: business.addressLine },
    "Your referral code",
    `<p>Hi ${client.firstName},</p><p>${pitch}</p><p style="font-size:24px;font-weight:700;letter-spacing:1px;margin:16px 0">${code}</p><p>They just type it in the “Referral code” box when booking online.</p><p style="margin-top:16px"><a href="${appUrl(`/book/${business.slug}`)}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Book at ${business.name}</a></p>`,
  );
  await queueOneOff(business.id, { channel: "email", template: "referral_code", recipient: client.email, subject: `Your ${business.name} referral code`, body: html, clientId: client.id });
  return client.email;
}
