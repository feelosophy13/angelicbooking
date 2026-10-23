import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema, withJobs, withTenant } from "@angelic/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { brandOf, helcim, HelcimError, last4Of, verifyCheckoutHash, type HelcimTransaction } from "./client";
import { helcimTokenOf } from "./account";
import { ensureHelcimCustomer } from "./payments";

type Business = typeof schema.businesses.$inferSelect;
type Checkout = typeof schema.helcimCheckouts.$inferSelect;
export type CheckoutPurpose = "deposit" | "card" | "order" | "invoice";

export class HelcimCheckoutError extends Error {}

const TYPE: Record<CheckoutPurpose, "purchase" | "verify" | "preauth"> = { deposit: "purchase", card: "verify", order: "preauth", invoice: "purchase" };

/**
 * Open a HelcimPay.js checkout for the booking page or the store: a deposit is charged (purchase), a card hold saves the card without a
 * charge (verify), a store order is authorised and captured once stock is confirmed (preauth). With a client, the card is saved to their
 * Helcim customer, which is what lets the salon charge a no-show fee later.
 */
export async function openHelcimCheckout(business: Business, input: { purpose: CheckoutPurpose; meta: Record<string, string>; amountCents: number; client?: { id: string; firstName: string; lastName: string; phone: string | null } | null }) {
  const token = helcimTokenOf(business);
  if (!token) throw new HelcimCheckoutError("Online payments are not set up.");
  const customer = input.client ? await ensureHelcimCustomer(business.id, token, input.client) : null;
  const s = await helcim.initializeCheckout(token, { paymentType: TYPE[input.purpose], amountCents: input.purpose === "card" ? 0 : input.amountCents, currency: business.currency, customerCode: customer?.code, brandColor: business.brandColor });
  const [row] = await withTenant(business.id, (tx) =>
    tx.insert(schema.helcimCheckouts).values({ businessId: business.id, purpose: input.purpose, meta: input.meta, amountCents: input.purpose === "card" ? 0 : input.amountCents, checkoutToken: s.checkoutToken, secretToken: encryptSecret(s.secretToken) }).returning(),
  );
  return { id: row!.id, checkoutToken: s.checkoutToken };
}

export async function getHelcimCheckout(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.helcimCheckouts.findFirst({ where: eq(schema.helcimCheckouts.id, id) }));
}

/**
 * Check a checkout's result. The first time, the browser's HelcimPay.js answer must carry a hash that matches this checkout's secret, and
 * the transaction is confirmed with Helcim (approved, the right kind, the right amount) before the checkout counts as paid. A page that
 * comes back later (a refresh, a double submit) gets the already-verified checkout.
 */
export async function verifyHelcimCheckout(business: Business, id: string, eventMessage: unknown): Promise<Checkout> {
  const row = await getHelcimCheckout(business.id, id);
  if (!row) throw new HelcimCheckoutError("That payment wasn't found. Please start again.");
  if (row.status === "paid" || row.status === "used") return row;
  if (row.status !== "open") throw new HelcimCheckoutError(row.status === "refunded" ? "This payment was refunded because the booking wasn't finished in time. Please book again." : "This payment was cancelled. Please start again.");
  const token = helcimTokenOf(business);
  if (!token) throw new HelcimCheckoutError("Online payments are not set up.");
  const msg = (typeof eventMessage === "string" ? JSON.parse(eventMessage) : eventMessage) as { data?: Record<string, unknown> & { transactionId?: number | string }; hash?: string } | null;
  if (!msg?.data || !msg.hash) throw new HelcimCheckoutError("Your card wasn't confirmed. Please try again.");
  if (!verifyCheckoutHash(msg.data, msg.hash, decryptSecret(row.secretToken))) throw new HelcimCheckoutError("Your payment couldn't be verified. Please try again.");
  const t = await helcim.getTransaction(token, String(msg.data.transactionId));
  if (t.status !== "APPROVED") throw new HelcimCheckoutError("Your card was declined. Please try another card.");
  if (t.type !== TYPE[row.purpose]) throw new HelcimCheckoutError("That payment doesn't match this booking. Please start again.");
  if (row.purpose !== "card" && Math.round(Number(t.amount) * 100) !== row.amountCents) throw new HelcimCheckoutError("The amount charged doesn't match. Please contact the salon.");
  const label = labelOf(t);
  const [updated] = await withTenant(business.id, (tx) =>
    tx.update(schema.helcimCheckouts).set({ status: "paid", transactionId: String(t.transactionId), cardLabel: label, paidAt: new Date() }).where(and(eq(schema.helcimCheckouts.id, row.id), eq(schema.helcimCheckouts.status, "open"))).returning(),
  );
  return updated ?? (await getHelcimCheckout(business.id, id))!;
}

export const labelOf = (t: Pick<HelcimTransaction, "cardType" | "cardNumber">) => {
  const last4 = last4Of(t.cardNumber);
  return last4 ? `${(brandOf(t.cardType) ?? "card").toUpperCase()} •••• ${last4}` : null;
};

/** The booking (or order) was made with this checkout's money. */
export async function markHelcimCheckoutUsed(businessId: string, id: string, tx?: Parameters<Parameters<typeof withTenant>[1]>[0]) {
  const run = (t: Parameters<Parameters<typeof withTenant>[1]>[0]) => t.update(schema.helcimCheckouts).set({ status: "used", usedAt: new Date() }).where(eq(schema.helcimCheckouts.id, id));
  if (tx) await run(tx);
  else await withTenant(businessId, run);
}

/** The client went back before paying: the open checkout is dropped. */
export async function voidHelcimCheckout(businessId: string, id: string) {
  await withTenant(businessId, (tx) => tx.update(schema.helcimCheckouts).set({ status: "void" }).where(and(eq(schema.helcimCheckouts.id, id), eq(schema.helcimCheckouts.status, "open"))));
}

/**
 * Give back money Helcim took (a deposit, all or part; an order that can't be filled). Same-day transactions that haven't settled can only
 * be reversed in full, so a full refund falls back to a reverse when Helcim says so.
 */
export async function refundHelcimTransaction(token: string, input: { key: string; transactionId: string; amountCents: number; full: boolean; ipAddress?: string }) {
  const ip = input.ipAddress ?? "127.0.0.1";
  try {
    const r = await helcim.refund(token, { key: input.key, transactionId: Number(input.transactionId), amountCents: input.amountCents, ipAddress: ip });
    if (r.status !== "APPROVED") throw new HelcimCheckoutError("Helcim declined the refund.");
    return r;
  } catch (e) {
    if (input.full && e instanceof HelcimError && /settl|batch|reverse/i.test(e.message)) return helcim.reverse(token, { key: input.key, transactionId: Number(input.transactionId), ipAddress: ip });
    throw e;
  }
}

/** A paid checkout that never became a booking (the slot was taken a moment before): refund it now and mark it refunded. */
export async function refundUnusedCheckout(business: Business, id: string) {
  const row = await getHelcimCheckout(business.id, id);
  const token = helcimTokenOf(business);
  if (!row || row.status !== "paid" || !row.transactionId || !token) return false;
  if (row.purpose !== "card") await refundHelcimTransaction(token, { key: `unused_${row.id}`, transactionId: row.transactionId, amountCents: row.amountCents, full: true });
  await withTenant(business.id, (tx) => tx.update(schema.helcimCheckouts).set({ status: row.purpose === "card" ? "void" : "refunded" }).where(and(eq(schema.helcimCheckouts.id, row.id), eq(schema.helcimCheckouts.status, "paid"))));
  return true;
}

/**
 * Checkouts that were paid but never used: the client's phone lost signal between paying and the booking being saved. Twenty minutes
 * after payment they are refunded (or, for a card hold, simply dropped) and the business's activity log says so. Run by the 5-minute job.
 */
export async function sweepHelcimCheckouts(): Promise<{ checked: number; refunded: number; failed: number }> {
  // Store orders are settled by the store's own sweep (capture or release after a stock check), and invoice payments by the invoice
  // sweep (recorded on the invoice, never refunded): not here.
  const stale = await withJobs((tx) => tx.select().from(schema.helcimCheckouts).where(and(eq(schema.helcimCheckouts.status, "paid"), sql`${schema.helcimCheckouts.purpose} not in ('order', 'invoice')`, lt(schema.helcimCheckouts.paidAt, sql`now() - interval '20 minutes'`))));
  let refunded = 0;
  let failed = 0;
  for (const row of stale) {
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, row.businessId) });
    if (!business) continue;
    // Booked after all (the booking was saved but marking the checkout failed): it is used, not orphaned.
    const booked = await withTenant(business.id, (tx) => tx.query.appointments.findFirst({ where: sql`${schema.appointments.depositPaymentIntentId} = ${row.id} or ${schema.appointments.cardSetupIntentId} = ${row.id}`, columns: { id: true } }));
    if (booked) {
      await markHelcimCheckoutUsed(business.id, row.id);
      continue;
    }
    try {
      if (await refundUnusedCheckout(business, row.id)) {
        refunded++;
        await withTenant(business.id, (tx) => tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId: null, action: "deposit.orphan_refund", entity: "helcim_checkout", entityId: row.id, diff: JSON.stringify({ cents: row.amountCents, purpose: row.purpose, note: "Paid online but the booking was never finished: refunded" }) }));
      }
    } catch (e) {
      failed++;
      console.error("[helcim] could not refund unused checkout", row.id, (e as Error).message);
    }
  }
  return { checked: stale.length, refunded, failed };
}
