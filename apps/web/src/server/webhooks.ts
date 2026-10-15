import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { syncConnectAccount } from "./stripe-connect";
import { tenantForAccount } from "./locations";
import { markCardPaymentFailed, markCardPaymentSucceeded } from "./sales";
import { handleRenewalFailed, handleRenewalInvoice, handleSubscriptionDeleted } from "./membership-billing";

/**
 * Process one Stripe Connect event. Idempotent: the event id is recorded in
 * webhook_events before processing and skipped if already processed.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  const accountId = event.account ?? null;
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ id: event.id, type: event.type, accountId, payload: event as unknown as Record<string, unknown> })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });
  if (inserted.length === 0) {
    const existing = await db.query.webhookEvents.findFirst({ where: eq(schema.webhookEvents.id, event.id) });
    if (existing?.processedAt) return "duplicate";
  }

  // The account is the business's main account, or one location's own account.
  let business = accountId ? await db.query.businesses.findFirst({ where: eq(schema.businesses.stripeAccountId, accountId) }) : null;
  let locationId: string | null = null;
  if (!business && accountId) {
    const t = await tenantForAccount(accountId);
    if (t) {
      business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, t.businessId) })) ?? null;
      locationId = t.locationId;
    }
  }

  try {
    let outcome: "processed" | "ignored" = "ignored";
    switch (event.type) {
      case "account.updated": {
        if (business && accountId) {
          await syncConnectAccount(business.id, accountId);
          outcome = "processed";
        }
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        if (business) {
          const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
          const card = charge?.payment_method_details?.card ?? charge?.payment_method_details?.card_present;
          await markCardPaymentSucceeded({
            businessId: business.id,
            paymentIntentId: pi.id,
            chargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
            card: { brand: card?.brand ?? null, last4: card?.last4 ?? null },
            taxRateBps: business.taxRateBps,
          });
          outcome = "processed";
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        if (business) {
          await markCardPaymentFailed(business.id, pi.id, pi.last_payment_error?.message ?? null);
          outcome = "processed";
        }
        break;
      }
      case "invoice.paid": {
        if (business) outcome = (await handleRenewalInvoice(business, event.data.object, locationId)) ? "processed" : "ignored";
        break;
      }
      case "invoice.payment_failed": {
        if (business) outcome = (await handleRenewalFailed(business, event.data.object)) ? "processed" : "ignored";
        break;
      }
      case "customer.subscription.deleted": {
        if (business) outcome = (await handleSubscriptionDeleted(business, event.data.object)) ? "processed" : "ignored";
        break;
      }
      case "charge.refunded":
      case "charge.dispute.created":
        // Refunds we initiate are recorded synchronously; disputes surface in the
        // business's own Stripe dashboard (Standard accounts). Logged for now.
        outcome = "processed";
        break;
      default:
        outcome = "ignored";
    }
    await db.update(schema.webhookEvents).set({ processedAt: new Date() }).where(eq(schema.webhookEvents.id, event.id));
    return outcome;
  } catch (e) {
    await db.update(schema.webhookEvents).set({ error: (e as Error).message }).where(eq(schema.webhookEvents.id, event.id));
    throw e;
  }
}
