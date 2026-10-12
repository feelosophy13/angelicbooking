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
