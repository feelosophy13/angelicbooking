export type Item = { quantity?: number; price?: { unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null } };

/** What a Stripe subscription charges per month for its licensed (flat or per-unit) items; metered usage is not included. */
export function monthlyFromItems(items: Item[]): number {
  let cents = 0;
  for (const i of items) {
    const r = i.price?.recurring;
    if (!r || r.usage_type === "metered" || typeof i.price?.unit_amount !== "number") continue;
    const months = r.interval === "year" ? 12 * (r.interval_count ?? 1) : r.interval === "month" ? (r.interval_count ?? 1) : r.interval === "week" ? ((r.interval_count ?? 1) * 7) / 30.4375 : ((r.interval_count ?? 1) / 30.4375);
    cents += Math.round((i.price.unit_amount * (i.quantity ?? 1)) / months);
  }
  return cents;
}

