/**
 * Carrier delivery receipts for texts (Twilio status callback). "sent" on a
 * notification only means Twilio accepted it; this records whether the carrier
 * delivered it, and turns an undelivered text into a failed row staff can see
 * and send again.
 */
import { and, eq } from "drizzle-orm";
import { schema, withJobs, withTenant } from "@angelic/db";

const RANK: Record<string, number> = { accepted: 1, scheduled: 1, queued: 1, sending: 1, sent: 2, delivered: 3, undelivered: 4, failed: 4 };

/** Twilio error codes that come up often, in words a front desk can act on. */
const REASONS: Record<string, string> = {
  "30003": "The phone was unreachable or switched off",
  "30004": "The message was blocked",
  "30005": "The number does not exist or is not active",
  "30006": "The number is a landline or cannot get texts",
  "30007": "A carrier filtered the message as spam",
  "30008": "The carrier could not deliver it (reason unknown)",
  "21610": "This person replied STOP to your number",
  "21614": "That is not a mobile number",
};

export function deliveryReason(code: string | null | undefined): string {
  return (code && REASONS[code]) || (code ? `Carrier error ${code}` : "The carrier could not deliver it");
}

/** Apply one Twilio status callback. Returns whether a notification was matched. Out-of-order callbacks never move a text backwards. */
export async function recordDeliveryStatus(input: { sid: string; status: string; errorCode?: string | null }): Promise<boolean> {
  const status = input.status.toLowerCase();
  const rank = RANK[status];
  if (!rank) return false;
  const found = await withJobs((tx) => tx.select({ id: schema.notifications.id, businessId: schema.notifications.businessId, deliveryStatus: schema.notifications.deliveryStatus }).from(schema.notifications).where(eq(schema.notifications.providerId, input.sid)).limit(1));
  const n = found[0];
  if (!n) return false;
  if ((RANK[n.deliveryStatus ?? ""] ?? 0) > rank) return true;
  const bad = status === "undelivered" || status === "failed";
  await withTenant(n.businessId, (tx) =>
    tx
      .update(schema.notifications)
      .set({
        deliveryStatus: status,
        ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
        ...(bad ? { status: "failed" as const, error: deliveryReason(input.errorCode) } : {}),
      })
      .where(and(eq(schema.notifications.id, n.id))),
  );
  return true;
}
