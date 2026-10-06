import { NextResponse } from "next/server";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/server/webhooks";

// One Connect webhook endpoint for every business. Stripe signs each event;
// `event.account` tells us which connected account (tenant) it belongs to.
export async function POST(req: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET.endsWith("...")) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return NextResponse.json({ error: `invalid signature: ${(e as Error).message}` }, { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // 500 makes Stripe retry; processing is idempotent.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
