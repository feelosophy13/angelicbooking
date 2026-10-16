import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { syncConnectAccount } from "./stripe-connect";
import { tenantForAccount } from "./locations";
import { markCardPaymentFailed, markCardPaymentSucceeded, recordStripeSideRefund } from "./sales";
import { withTenant } from "@angelic/db";
import { queueOneOff } from "@/lib/notify";
import { sendOrderEmailsOnce } from "./store";
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
            metadata: pi.metadata,
          });
          // An online order paid while the buyer's page was closed still gets its receipt and gift card emails (sent once).
          if (pi.metadata?.kind === "order" && pi.metadata.saleId && pi.metadata.businessId === business.id) await sendOrderEmailsOnce(business.id, pi.metadata.saleId);
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
        if (business) outcome = (await handleRenewalInvoice(business, event.data.object, locationId, accountId)) ? "processed" : "ignored";
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
      case "charge.refunded": {
        // Refunds we make are recorded as we make them; one made in the Stripe dashboard is recorded here.
        const charge = event.data.object;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (business && piId) {
          const refundId = charge.refunds?.data?.[0]?.id ?? null;
          await recordStripeSideRefund({ businessId: business.id, paymentIntentId: piId, refundedTotalCents: charge.amount_refunded, refundId, taxRateBps: business.taxRateBps });
          outcome = "processed";
        }
        break;
      }
      case "charge.dispute.created": {
        // A chargeback: the owner needs to answer it in Stripe before the deadline, so they hear about it now.
        const dispute = event.data.object;
        if (business) {
          const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
          await withTenant(business.id, (tx) => tx.insert(schema.auditLog).values({ businessId: business!.id, actorUserId: null, action: "payment.disputed", entity: "payment_intent", entityId: piId, diff: JSON.stringify({ amountCents: dispute.amount, reason: dispute.reason, respondBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null }) }));
          if (business.email) {
            const due = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toDateString() : "soon";
            await queueOneOff(business.id, { channel: "email", template: "dispute_alert", recipient: business.email, subject: `A client disputed a $${(dispute.amount / 100).toFixed(2)} charge`, body: `<p>A card payment of $${(dispute.amount / 100).toFixed(2)} was disputed (reason: ${dispute.reason.replace(/_/g, " ")}).</p><p>Respond with evidence in your Stripe dashboard by <b>${due}</b>, or the money goes back to the client. Signed forms, the booking and the cancellation policy they agreed to help.</p>` }).catch(() => undefined);
          }
          outcome = "processed";
        }
        break;
      }
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
