import "server-only";
import { monthlyFromItems, type Item } from "./stripe-items";

export type Actual = { monthlyCents: number; status: string } | null;

/**
 * Read-only lookup of a business's subscription on the platform Stripe account. Needs STRIPE_SECRET_KEY in the
 * admin service (use a restricted key that can only read subscriptions). Returns null when not configured or on any error.
 */
export async function actualBilling(subscriptionId: string | null): Promise<Actual> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!subscriptionId || !key || key.includes("...")) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    if (!res.ok) return null;
    const sub = (await res.json()) as { status: string; items?: { data?: Item[] } };
    return { monthlyCents: monthlyFromItems(sub.items?.data ?? []), status: sub.status };
  } catch {
    return null;
  }
}
