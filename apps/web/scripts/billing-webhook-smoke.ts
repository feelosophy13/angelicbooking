/**
 * Send a signed customer.subscription.updated event for a business's real
 * sandbox subscription to the local billing webhook. Usage (from apps/web,
 * dev server running on 3001 with STRIPE_BILLING_WEBHOOK_SECRET set):
 *   pnpm exec tsx --env-file=../../.env scripts/billing-webhook-smoke.ts <slug>
 */
import { eq } from "drizzle-orm";
import { db, getSql, schema } from "@angelic/db";
import { stripe } from "../src/lib/stripe";

async function main() {
  const slug = process.argv[2] ?? "angelic-salon";
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business?.stripeSubscriptionId) throw new Error("business has no subscription");
  const sub = await stripe().subscriptions.retrieve(business.stripeSubscriptionId);
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET!;
  const payload = JSON.stringify({
    id: `evt_smoke_${Date.now()}`,
    object: "event",
    api_version: "2025-10-29.clover",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.updated",
    data: { object: sub },
  });
  const signature = stripe().webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch("http://localhost:3001/api/stripe/billing", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload });
  console.log("signed event:", res.status, await res.text());
  const bad = await fetch("http://localhost:3001/api/stripe/billing", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=bad" }, body: payload });
  console.log("bad signature:", bad.status);
  const after = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, business.id), columns: { subscriptionStatus: true, currentPeriodEnd: true } });
  console.log("db after:", after);
  await getSql().end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
