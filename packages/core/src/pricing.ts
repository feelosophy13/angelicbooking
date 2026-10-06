/** Pure money math for checkout. All amounts are integer cents. */

export interface PricingLine {
  kind: "service" | "product" | "tip" | "fee" | "adjustment";
  amountCents: number;
  taxable: boolean;
  staffId?: string | null;
}

export interface Discount {
  type: "amount" | "percent";
  value: number; // cents for amount, whole percent (e.g. 10) for percent
}

export interface Totals {
  subtotalCents: number; // services + products + fees (pre-discount)
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

export function clampCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

/**
 * Totals for a sale. The discount applies proportionally to taxable and
 * non-taxable goods, so tax is charged on the discounted taxable amount.
 */
export function computeTotals(lines: PricingLine[], discount: Discount | null, taxRateBps: number): Totals {
  const goods = lines.filter((l) => l.kind !== "tip");
  const subtotal = goods.reduce((s, l) => s + clampCents(l.amountCents), 0);
  const taxableBase = goods.filter((l) => l.taxable).reduce((s, l) => s + clampCents(l.amountCents), 0);
  const tipCents = lines.filter((l) => l.kind === "tip").reduce((s, l) => s + clampCents(l.amountCents), 0);

  let discountCents = 0;
  if (discount && subtotal > 0) {
    discountCents =
      discount.type === "percent"
        ? Math.round((subtotal * Math.min(100, Math.max(0, discount.value))) / 100)
        : Math.min(subtotal, clampCents(discount.value));
  }
  const discountedTaxable = subtotal > 0 ? Math.round(taxableBase * (1 - discountCents / subtotal)) : 0;
  const taxCents = Math.round((discountedTaxable * Math.max(0, taxRateBps)) / 10_000);
  const totalCents = subtotal - discountCents + taxCents + tipCents;
  return { subtotalCents: subtotal, discountCents, taxCents, tipCents, totalCents };
}

/**
 * Split an amount across staff in proportion to their service revenue
 * (largest-remainder so the parts sum exactly). Used for "tip on the whole
 * ticket" when the client doesn't specify per provider.
 */
export function allocateProportionally(amountCents: number, weights: { key: string; weight: number }[]): Record<string, number> {
  const total = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  const out: Record<string, number> = {};
  if (amountCents <= 0 || weights.length === 0) return out;
  if (total <= 0) {
    // Equal split
    const each = Math.floor(amountCents / weights.length);
    let rem = amountCents - each * weights.length;
    for (const w of weights) out[w.key] = each + (rem-- > 0 ? 1 : 0);
    return out;
  }
  const raw = weights.map((w) => ({ key: w.key, exact: (amountCents * Math.max(0, w.weight)) / total }));
  let assigned = 0;
  for (const r of raw) {
    out[r.key] = Math.floor(r.exact);
    assigned += out[r.key]!;
  }
  let rem = amountCents - assigned;
  for (const r of raw.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (rem <= 0) break;
    out[r.key]! += 1;
    rem--;
  }
  return out;
}

/** Parse a user-typed money string ("45", "45.5", "$1,200.00") into cents. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
