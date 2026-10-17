"use client";
import { useActionState, useState } from "react";
import { cancelAppointment, type ActionState } from "./actions";
import { Checkbox, Input, Notice, Radio, RadioGroup, Select } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";

/**
 * Cancel from the appointment page. Inside the cancellation window with a fee set, it says what
 * the client owes, how much a kept deposit covers, and offers to charge the rest to a saved card.
 */
type DepositChoice = "keep" | "fee_only" | "refund_all";
export function CancelForm(props: { slug: string; appointmentId: string; late: null | { feeLabel: string; depositCoversLabel: string | null; chargeLabel: string | null; chargeCents: number }; cards: { id: string; brand: string; last4: string }[]; reasons: { id: string; name: string }[]; deposit: null | { totalLabel: string; feeOnly: null | { keepLabel: string; refundLabel: string }; canRefund: boolean; defaultChoice: DepositChoice } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelAppointment, undefined);
  const canCharge = !!props.late && props.late.chargeCents > 0 && props.cards.length > 0;
  const [charge, setCharge] = useState(canCharge);
  const [depositChoice, setDepositChoice] = useState<DepositChoice>(props.deposit?.defaultChoice ?? "keep");
  if (state?.ok) return <Notice kind="success">Appointment cancelled.</Notice>;
  const l = props.late;
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="appointmentId" value={props.appointmentId} />
      {l ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p><b>Inside the cancellation window.</b> Late fee {l.feeLabel}{l.depositCoversLabel ? `; ${l.depositCoversLabel} of the deposit covers ${l.chargeCents > 0 ? "part of it" : "it"}` : ""}.</p>
          {l.chargeCents > 0 ? (
            props.cards.length ? (
              <div className="mt-2 space-y-2">
                <Checkbox name="chargeFee" checked={charge} onChange={(e) => setCharge(e.target.checked)} label={`Charge ${l.chargeLabel} to the saved card`} className="text-xs" />
                {charge ? (
                  <Select name="paymentMethodId" className="h-8 max-w-xs text-xs">
                    {props.cards.map((c) => <option key={c.id} value={c.id}>{c.brand.toUpperCase()} •••• {c.last4}</option>)}
                  </Select>
                ) : null}
              </div>
            ) : (
              <p className="mt-1">No card on file, so {l.chargeLabel} can be collected at the next visit.</p>
            )
          ) : null}
        </div>
      ) : null}
      {props.deposit ? (
        <RadioGroup legend={`The ${props.deposit.totalLabel} deposit`} className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-700">
          {props.deposit.canRefund ? (
            <>
              {([
                ["keep", `Keep all of it${props.late ? " (late cancellation)" : ""}`] as const,
                ...(props.deposit.feeOnly ? [["fee_only", `Keep ${props.deposit.feeOnly.keepLabel} for the late fee, refund ${props.deposit.feeOnly.refundLabel}`] as const] : []),
                ["refund_all", `Refund all ${props.deposit.totalLabel} (the salon cancelled, or waive the fee)`] as const,
              ]).map(([value, label]) => (
                <Radio key={value} name="deposit" value={value} checked={depositChoice === value} onChange={() => setDepositChoice(value)} label={label} />
              ))}
            </>
          ) : (
            <p>The salon keeps it. Giving a deposit back needs the refund permission; ask the owner or manager.</p>
          )}
        </RadioGroup>
      ) : null}
      <Select name="reasonId" required defaultValue="" aria-label="Why is it being cancelled?">
        <option value="" disabled>Why is it being cancelled?</option>
        {props.reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Input name="reason" placeholder="Note (optional)" />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <ConfirmSubmit title="Cancel this appointment?" body={`The client is notified if they have messages turned on. The time becomes available again.${l && charge && l.chargeCents > 0 ? ` The saved card is charged ${l.chargeLabel}.` : ""}${props.deposit?.canRefund ? (depositChoice === "refund_all" ? ` The ${props.deposit.totalLabel} deposit is refunded to the client.` : depositChoice === "fee_only" && props.deposit.feeOnly ? ` ${props.deposit.feeOnly.refundLabel} of the deposit is refunded; the salon keeps ${props.deposit.feeOnly.keepLabel}.` : ` The salon keeps the ${props.deposit.totalLabel} deposit.`) : ""}`} confirmLabel={l && charge && l.chargeCents > 0 ? `Cancel and charge ${l.chargeLabel}` : "Cancel appointment"} variant="danger" className="w-full">{pending ? "Cancelling…" : "Cancel appointment"}</ConfirmSubmit>
    </form>
  );
}
