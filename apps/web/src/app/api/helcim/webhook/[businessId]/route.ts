import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { verifyWebhookSignature } from "@/server/helcim/client";
import { helcimTokenOf, helcimVerifierOf } from "@/server/helcim/account";
import { handleHelcimCardTransaction, handleHelcimTerminalCancel } from "@/server/helcim/payments";

/**
 * Helcim webhooks, one URL per business (Helcim's events carry no account id): Settings → Payments shows the URL to paste into the
 * merchant's Helcim webhook settings. Each delivery is signed with that merchant's verifier token, recorded once in webhook_events,
 * and answered 2xx only when handled, so Helcim retries (for about ten hours) anything that failed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
  if (!business || business.paymentProvider !== "helcim") return NextResponse.json({ error: "unknown business" }, { status: 404 });
  const verifier = helcimVerifierOf(business);
  const token = helcimTokenOf(business);
  if (!verifier || !token) return NextResponse.json({ error: "Helcim not fully connected" }, { status: 503 });
  const body = await req.text();
  const id = req.headers.get("webhook-id");
  if (!verifyWebhookSignature({ id, timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") }, body, verifier)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(body) as { type?: string; id?: string | number; data?: { invoiceNumber?: string } };
  const eventId = `helcim_${businessId}_${id}`;
  const inserted = await db.insert(schema.webhookEvents).values({ id: eventId, provider: "helcim", type: event.type ?? "unknown", accountId: businessId, payload: event as Record<string, unknown> }).onConflictDoNothing().returning({ id: schema.webhookEvents.id });
  if (!inserted.length) {
    const seen = await db.query.webhookEvents.findFirst({ where: eq(schema.webhookEvents.id, eventId) });
    if (seen?.processedAt) return NextResponse.json({ received: true, outcome: "duplicate" });
  }
  try {
    let outcome = "ignored";
    if (event.type === "cardTransaction" && event.id != null) outcome = await handleHelcimCardTransaction({ businessId, token, transactionId: String(event.id), taxRateBps: business.taxRateBps });
    else if (event.type === "terminalCancel" && event.data?.invoiceNumber) outcome = await handleHelcimTerminalCancel(businessId, event.data.invoiceNumber);
    await db.update(schema.webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(schema.webhookEvents.id, eventId));
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    await db.update(schema.webhookEvents).set({ error: (e as Error).message }).where(eq(schema.webhookEvents.id, eventId));
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
