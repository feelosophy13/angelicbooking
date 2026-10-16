/**
 * Texting consent that holds across every client record and every way a message is queued:
 *   - a STOP reply (or the carrier saying the person opted out) puts the number on the business's suppression list, turns texts off on
 *     every client with that number, and cancels texts already queued to it;
 *   - START takes the number off the list and turns appointment texts back on (marketing texts stay off until the client consents again);
 *   - the delivery step checks the list again right before sending (lib/notify).
 * Numbers are compared by their last ten digits, like the inbox does.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type TenantDb } from "@angelic/db";

/** The last ten digits of a phone ("" when there aren't seven), so "(555) 555-0177" and "+15555550177" match. */
export const phoneTail = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length >= 7 ? d : "";
};

const tailOf = (col: typeof schema.clients.phone | typeof schema.notifications.recipient) => sql`right(regexp_replace(${col}, '\\D', '', 'g'), 10)`;

export type SuppressionSource = "stop" | "carrier" | "staff";

/** Stop texting this number. Runs inside the business's tenant transaction. */
export async function suppressSms(tx: TenantDb, businessId: string, phone: string, source: SuppressionSource) {
  const tail = phoneTail(phone);
  if (!tail) return;
  await tx.insert(schema.smsSuppressions).values({ businessId, phoneTail: tail, source }).onConflictDoNothing();
  await tx.update(schema.clients).set({ smsOptIn: false, smsMarketingOptIn: false }).where(sql`${tailOf(schema.clients.phone)} = ${tail}`);
  await tx
    .update(schema.notifications)
    .set({ status: "cancelled", error: "The person opted out of texts (STOP)" })
    .where(and(eq(schema.notifications.channel, "sms"), eq(schema.notifications.status, "queued"), sql`${tailOf(schema.notifications.recipient)} = ${tail}`));
}

/** START: texting this number is allowed again; appointment texts come back on for its clients. Marketing texts need fresh consent. */
export async function unsuppressSms(tx: TenantDb, businessId: string, phone: string) {
  const tail = phoneTail(phone);
  if (!tail) return;
  await tx.delete(schema.smsSuppressions).where(and(eq(schema.smsSuppressions.businessId, businessId), eq(schema.smsSuppressions.phoneTail, tail)));
  await tx.update(schema.clients).set({ smsOptIn: true }).where(sql`${tailOf(schema.clients.phone)} = ${tail}`);
}

export async function isSmsSuppressed(tx: TenantDb, phone: string | null | undefined): Promise<boolean> {
  const tail = phoneTail(phone);
  if (!tail) return false;
  const row = await tx.query.smsSuppressions.findFirst({ where: eq(schema.smsSuppressions.phoneTail, tail), columns: { phoneTail: true } });
  return Boolean(row);
}

/** Which of these numbers are suppressed, as a set of tails. */
export async function suppressedTails(tx: TenantDb, phones: string[]): Promise<Set<string>> {
  const tails = [...new Set(phones.map(phoneTail).filter(Boolean))];
  if (!tails.length) return new Set();
  const rows = await tx.select({ t: schema.smsSuppressions.phoneTail }).from(schema.smsSuppressions).where(inArray(schema.smsSuppressions.phoneTail, tails));
  return new Set(rows.map((r) => r.t));
}

/** Written consent to marketing texts, with when and how it was given (kept as evidence). */
export function smsMarketingConsent(given: boolean, source: string) {
  return given ? { smsMarketingOptIn: true, smsMarketingConsentAt: new Date(), smsMarketingConsentSource: source } : { smsMarketingOptIn: false };
}
