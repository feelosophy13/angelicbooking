/**
 * The processor's own numbers for a day, for the closing report to set beside what the app expects: Stripe's balance transactions
 * (gross, fees, net) and the payouts arriving that day; Helcim's card batches closed that day (Helcim's batches carry no fees).
 * Read live from the processor each time; any failure comes back as an `error` line rather than breaking the report.
 */
import type { schema } from "@angelic/db";
import { stripe } from "@/lib/stripe";
import { helcim, type HelcimCardBatch } from "./helcim/client";
import { helcimTokenOf } from "./helcim/account";
import { paymentContextFor } from "./locations";

type Business = typeof schema.businesses.$inferSelect;

export type ProcessorActuals =
  | { provider: "stripe"; sharedAccount: boolean; grossCents: number; refundsCents: number; feesCents: number; netCents: number; payouts: { amountCents: number; status: string }[] }
  | { provider: "helcim"; batches: { id: number; closedAt: string | null; salesCents: number; refundsCents: number; netCents: number; count: number }[] }
  | { provider: "stripe" | "helcim"; error: string };

const cents = (dollars: number | undefined) => Math.round(Number(dollars ?? 0) * 100);

/** Pure: Helcim batches that closed on `date` (YYYY-MM-DD in Helcim's own clock, Mountain Time). */
export function batchesClosedOn(batches: HelcimCardBatch[], date: string) {
  return batches
    .filter((b) => (b.dateClosed ?? "").startsWith(date))
    .map((b) => ({ id: b.id, closedAt: b.dateClosed ?? null, salesCents: cents(b.totalSales), refundsCents: cents(b.totalRefunds) + cents(b.totalReversed), netCents: cents(b.netSales), count: Number(b.countApproved ?? 0) }));
}

/** Pure: Stripe balance transactions totalled. Charges and payments add to gross; refunds (negative amounts) to refunds; fees on everything. */
export function totalBalance(rows: { type: string; amount: number; fee: number; net: number }[]) {
  let grossCents = 0, refundsCents = 0, feesCents = 0, netCents = 0;
  for (const r of rows) {
    if (r.type === "payout" || r.type === "payout_cancel" || r.type === "payout_failure") continue;
    if (r.type === "charge" || r.type === "payment") grossCents += r.amount;
    else if (r.type === "refund" || r.type === "payment_refund") refundsCents += -r.amount;
    feesCents += r.fee;
    netCents += r.net;
  }
  return { grossCents, refundsCents, feesCents, netCents };
}

export async function processorActuals(business: Business, locationId: string, from: Date, to: Date, date: string): Promise<ProcessorActuals | null> {
  const ctx = await paymentContextFor(business, locationId);
  if (ctx.provider === "helcim") {
    const token = helcimTokenOf(business);
    if (!token) return null;
    try {
      return { provider: "helcim", batches: batchesClosedOn(await helcim.cardBatches(token), date) };
    } catch (e) {
      console.error("processorActuals helcim", e);
      return { provider: "helcim", error: "Helcim didn't answer. Try again in a minute, or check the connection under Settings → Payments." };
    }
  }
  if (!ctx.ready || !ctx.accountId) return null;
  try {
    const gte = Math.floor(from.getTime() / 1000), lt = Math.floor(to.getTime() / 1000);
    const opts = { stripeAccount: ctx.accountId };
    const rows: { type: string; amount: number; fee: number; net: number }[] = [];
    for await (const t of stripe().balanceTransactions.list({ created: { gte, lt }, limit: 100 }, opts)) rows.push(t);
    const payouts: { amountCents: number; status: string }[] = [];
    for await (const p of stripe().payouts.list({ arrival_date: { gte, lt }, limit: 100 }, opts)) payouts.push({ amountCents: p.amount, status: p.status });
    return { provider: "stripe", sharedAccount: ctx.usesMainAccount && (await sharesAccount(business, ctx.accountId)), ...totalBalance(rows), payouts };
  } catch (e) {
    // Stripe's messages can quote the platform key (masked) or account ids: log them, show a plain line.
    console.error("processorActuals stripe", e);
    return { provider: "stripe", error: "Stripe didn't answer. Try again in a minute, or check the connection under Settings → Payments." };
  }
}

/** Whether other locations take money on the same Stripe account (then its numbers cover them too). */
async function sharesAccount(business: Business, accountId: string) {
  const { listLocations, paymentContext } = await import("./locations");
  const locs = await listLocations(business.id);
  return locs.filter((l) => paymentContext(business, l).accountId === accountId).length > 1;
}
