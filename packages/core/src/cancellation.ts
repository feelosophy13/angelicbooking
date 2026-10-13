/** Late-cancellation fees: what the business is owed when a client cancels inside the window. */

export type LateCancelPolicy = { feeType: "none" | "flat" | "percent"; feeValue: number; deposit: "toward" | "extra" };

/** True when `startAt` is less than `windowHours` away (or already past). */
export function isInsideCancelWindow(startAt: Date, windowHours: number, now: Date = new Date()): boolean {
  return startAt.getTime() - now.getTime() < windowHours * 3_600_000;
}

/**
 * The fee for cancelling late. `servicesCents` is the booked services' price, `depositCents` the
 * deposit already paid. Returns the fee, how much of it a kept deposit covers, and what is left
 * to charge the card.
 */
export function lateCancelFee(policy: LateCancelPolicy, servicesCents: number, depositCents: number): { feeCents: number; depositCoversCents: number; chargeCents: number } {
  const feeCents = policy.feeType === "flat" ? Math.max(0, policy.feeValue) : policy.feeType === "percent" ? Math.round((servicesCents * Math.max(0, policy.feeValue)) / 10_000) : 0;
  const depositCoversCents = policy.deposit === "toward" ? Math.min(depositCents, feeCents) : 0;
  return { feeCents, depositCoversCents, chargeCents: Math.max(0, feeCents - depositCoversCents) };
}

/** "$25.00" or "50% of the booked services" for policy text. */
export function lateCancelFeeLabel(policy: LateCancelPolicy, money: (cents: number) => string): string | null {
  if (policy.feeType === "flat" && policy.feeValue > 0) return money(policy.feeValue);
  if (policy.feeType === "percent" && policy.feeValue > 0) return `${policy.feeValue / 100}% of the booked services`;
  return null;
}

/**
 * Compare the owner's free-text booking policy with the structured late fee. Looks at sentences
 * about cancelling, lateness or fees that quote an amount. A sentence that quotes the same fee
 * "repeats" it; one that quotes a different amount or percent "conflicts" with it.
 */
export function policyFeeCheck(text: string | null | undefined, policy: LateCancelPolicy): { repeats: string[]; conflicts: string[] } {
  const out = { repeats: [] as string[], conflicts: [] as string[] };
  if (!text || policy.feeType === "none" || policy.feeValue <= 0) return out;
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence || !/cancel|late|no-?show|fee|charge/i.test(sentence)) continue;
    const money = [...sentence.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Math.round(Number(m[1]) * 100));
    const percent = [...sentence.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Math.round(Number(m[1]) * 100));
    if (!money.length && !percent.length) continue;
    const same = policy.feeType === "flat" ? percent.length === 0 && money.every((c) => c === policy.feeValue) : money.length === 0 && percent.every((b) => b === policy.feeValue);
    (same ? out.repeats : out.conflicts).push(sentence);
  }
  return out;
}
