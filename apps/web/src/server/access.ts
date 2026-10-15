/**
 * What a business may do right now: use the app (trial / subscription), be visible on the web, send messages.
 * The rules are pure (lib/access.ts); this feeds them from the database.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { accessState, type Access } from "@/lib/access";
import { isSubscribed } from "@/lib/billing-config";
import { billingEnabled } from "@/server/billing";
import { priceBookFor } from "@/server/price-book";

type Business = typeof schema.businesses.$inferSelect;

/** Trial / subscription state. Skips the price-book lookup for the businesses that can never be locked. */
export async function businessAccess(b: Business): Promise<Access> {
  const neverLocked = b.comped || isSubscribed(b.subscriptionStatus) || !billingEnabled();
  if (neverLocked) return { state: "ok" };
  const endedSubscription = ["canceled", "incomplete_expired", "unpaid"].includes(b.subscriptionStatus);
  if (!b.trialEndsAt && !endedSubscription) return { state: "ok" }; // grandfathered
  const book = await priceBookFor(b.id);
  return accessState({ billingEnabled: true, comped: b.comped, status: b.subscriptionStatus, trialEndsAt: b.trialEndsAt, baseCents: book.baseCents });
}

/** Has an owner of this business confirmed their email address? */
export async function ownerEmailVerified(businessId: string): Promise<boolean> {
  const rows = await db
    .select({ v: schema.user.emailVerified })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, businessId), eq(schema.member.role, "owner")));
  return rows.some((r) => r.v);
}

/** Why a business is kept off the public web and silent, or null. New businesses wait for a verified owner email. */
export async function publishBlockedReason(b: Business): Promise<string | null> {
  if (b.publishRequiresVerified && !(await ownerEmailVerified(b.id))) return "Verify your email to publish your booking page and send messages.";
  return null;
}
