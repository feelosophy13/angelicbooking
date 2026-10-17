import { lateCancelFeeLabel, policyFeeCheck } from "@angelic/core";
import { formatMoney } from "@/lib/utils";

type PolicySource = { bookingPolicy: string | null; cancelWindowHours: number; lateCancelFeeType: string; lateCancelFeeValue: number; lateCancelDeposit: string; currency: string };

/** The late fee as shown to clients, unless the owner's own policy text already states that same fee. */
export function lateFeeLabelFor(b: PolicySource): string | null {
  const latePolicy = { feeType: b.lateCancelFeeType as "none" | "flat" | "percent", feeValue: b.lateCancelFeeValue, deposit: b.lateCancelDeposit as "toward" | "extra" };
  return policyFeeCheck(b.bookingPolicy, latePolicy).repeats.length ? null : lateCancelFeeLabel(latePolicy, (c) => formatMoney(c, b.currency));
}

/** The cancellation policy line the booking forms show, and that an online booking saves as what the client agreed to. */
export function policyLine(p: { cancelWindowHours: number; lateFee?: string | null; policy: string | null }): string {
  return `You can cancel or reschedule online up to ${p.cancelWindowHours} hours before.${p.lateFee ? ` Cancellations inside that window carry a fee of ${p.lateFee}.` : ""}${p.policy ? ` ${p.policy}` : ""}`;
}

/** What is saved on an online booking. */
export function policySnapshot(b: PolicySource): string {
  return policyLine({ cancelWindowHours: b.cancelWindowHours, lateFee: lateFeeLabelFor(b), policy: b.bookingPolicy });
}
