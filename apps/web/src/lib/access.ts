/**
 * Whether a business may use the product, from its trial and subscription. Pure so it is unit tested; server/access.ts
 * feeds it the business row and price book.
 */
import { isSubscribed } from "./billing-config";

export type Access =
  | { state: "ok" }
  | { state: "trial"; daysLeft: number; endsAt: Date }
  | { state: "expired"; endedAt: Date | null };

const DAY = 86_400_000;
const ENDED = ["canceled", "incomplete_expired", "unpaid"];

/**
 * - Never locked: comped businesses, ones with an active or trialing subscription (or past_due while Stripe retries), a platform
 *   without Stripe billing, and a free platform (base plan $0: a card is only collected for add-ons).
 * - Older businesses have no trial end date and are grandfathered: they are never locked by this rule.
 * - A cancelled or unpaid subscription is locked whatever the trial says.
 * - Otherwise: in trial until `trialEndsAt`, expired after.
 */
export function accessState(o: { billingEnabled: boolean; comped: boolean; status: string; trialEndsAt: Date | null; baseCents: number; now?: number }): Access {
  const now = o.now ?? Date.now();
  if (o.comped || !o.billingEnabled || o.baseCents <= 0) return { state: "ok" };
  if (o.status === "active" || o.status === "trialing" || isSubscribed(o.status)) return { state: "ok" };
  if (ENDED.includes(o.status)) return { state: "expired", endedAt: o.trialEndsAt };
  if (!o.trialEndsAt) return { state: "ok" };
  const left = o.trialEndsAt.getTime() - now;
  if (left > 0) return { state: "trial", daysLeft: Math.max(1, Math.ceil(left / DAY)), endsAt: o.trialEndsAt };
  return { state: "expired", endedAt: o.trialEndsAt };
}

/** The daily email allowance while a business has no subscription, or null when it is not limited. */
export function emailDailyCap(o: { comped: boolean; status: string; cap: number }): number | null {
  if (o.comped || isSubscribed(o.status) || o.cap <= 0) return null;
  return o.cap;
}

/** Reserved web addresses and look-alikes of the platform's own paths: nobody can register these as a business address. */
const RESERVED = new Set([
  "admin", "administrator", "app", "api", "www", "book", "booking", "embed", "clock", "account", "accounts", "help", "support", "login", "logout",
  "sign-in", "sign-up", "signin", "signup", "billing", "status", "mail", "email", "root", "system", "staff", "static", "assets", "public", "dashboard",
  "developers", "docs", "terms", "privacy", "legal", "onboarding", "invite", "print", "tollfree", "suspended", "angelic", "angelicbooking", "stripe", "twilio", "demo",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug) || slug.startsWith("demo-") || slug.startsWith("_");
}

/** A usable address base from a business name: never reserved, never empty, never looks like a demo tenant. */
export function safeSlugBase(slug: string): string {
  let s = slug.replace(/^demo-+/, "").replace(/^[-_]+/, "");
  if (!s) s = "business";
  return isReservedSlug(s) ? `${s}-business` : s;
}

/**
 * The trial to put on a new Stripe subscription so a business that adds its card early is not charged until its trial ends.
 * Stripe needs a trial end at least 48 hours away; with less left, or an expired trial, the first charge is immediate.
 * Older businesses with no trial date get the price book's trial length instead.
 */
export function checkoutTrial(trialEndsAt: Date | null, trialDays: number, now = Date.now()): { trial_end?: number; trial_period_days?: number } {
  if (trialEndsAt) return trialEndsAt.getTime() - now > 2 * DAY ? { trial_end: Math.floor(trialEndsAt.getTime() / 1000) } : {};
  return trialDays > 0 ? { trial_period_days: trialDays } : {};
}
