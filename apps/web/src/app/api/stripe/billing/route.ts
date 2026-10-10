import { NextResponse } from "next/server";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { handleBillingEvent } from "@/server/billing";

// ACCOUNT-level webhook (events on the platform's own account: subscriptions,
// invoices, checkout). The Connect endpoint lives at /api/stripe/webhook.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret || secret.endsWith("...")) {
    return NextResponse.json({ error: "Billing webhook not configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `invalid signature: ${(e as Error).message}` }, { status: 400 });
  }
  try {
    const outcome = await handleBillingEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
