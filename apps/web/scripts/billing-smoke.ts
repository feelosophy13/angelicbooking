/**
 * Exercise the platform-billing add-on and usage paths against the Stripe
 * sandbox for one business. Usage (from apps/web):
 *   pnpm exec tsx --env-file=../../.env scripts/billing-smoke.ts <business-slug>
 * Needs a business that already completed Checkout (active subscription) and
 * an active messaging_numbers row.
 */
import { eq, isNull } from "drizzle-orm";
import { db, getSql, schema, withTenant } from "@angelic/db";
import { stripe } from "../src/lib/stripe";
import { attachNumberItem, detachNumberItem, ensureCatalog, refreshSubscription, reportSmsUsage } from "../src/server/billing";

async function main() {
  const slug = process.argv[2] ?? "angelic-salon";
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business) throw new Error(`no business ${slug}`);
  console.log("business", business.name, "status", business.subscriptionStatus, "sub", business.stripeSubscriptionId);

  const catalog = await ensureCatalog();
  console.log("catalog", { base: catalog.basePriceId, number: catalog.numberPriceId, usage: catalog.usagePriceId, meter: catalog.meterId });

  const number = await withTenant(business.id, (tx) => tx.query.messagingNumbers.findFirst({ where: isNull(schema.messagingNumbers.releasedAt) }));
  if (!number) throw new Error("no active number row");

  await attachNumberItem(business, number.id);
  let sub = await stripe().subscriptions.retrieve(business.stripeSubscriptionId!);
  console.log("after attach:", sub.items.data.map((i) => `${i.price.lookup_key} x${i.quantity ?? "metered"}`));
  const row = await withTenant(business.id, (tx) => tx.query.messagingNumbers.findFirst({ where: eq(schema.messagingNumbers.id, number.id) }));
  console.log("number.stripeItemId", row?.stripeItemId);

  const sent = await reportSmsUsage(business.id, [`smoke-${Date.now()}`, `smoke-${Date.now()}-b`]);
  console.log("meter events accepted:", sent);

  await detachNumberItem(business, { id: number.id, stripeItemId: row?.stripeItemId ?? null });
  sub = await stripe().subscriptions.retrieve(business.stripeSubscriptionId!);
  console.log("after detach:", sub.items.data.map((i) => i.price.lookup_key));

  const upcoming = await stripe().invoices.createPreview({ customer: business.stripeCustomerId!, subscription: business.stripeSubscriptionId! });
  console.log("upcoming invoice lines:", upcoming.lines.data.map((l) => `${l.description} ${l.amount}`), "total", upcoming.total);

  await refreshSubscription(business);
  await getSql().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
