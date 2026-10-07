"use client";
import { useActionState } from "react";
import { chargeNoShowFee, type ActionState } from "./actions";
import { Input, Notice, Select } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";

export function NoShowFeeForm(props: { slug: string; appointmentId: string; defaultAmount: string; cards: { id: string; brand: string; last4: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(chargeNoShowFee, undefined);
  if (state?.ok) return <Notice kind="success">No-show fee charged.</Notice>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="appointmentId" value={props.appointmentId} />
      <Select name="paymentMethodId">
        {props.cards.map((c) => <option key={c.id} value={c.id}>{c.brand.toUpperCase()} •••• {c.last4}</option>)}
      </Select>
      <Input name="amount" inputMode="decimal" defaultValue={props.defaultAmount} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <ConfirmSubmit title="Charge the no-show fee?" body="The saved card is charged now and the appointment is marked as a no-show." confirmLabel="Charge card" variant="danger" className="w-full">{pending ? "Charging…" : "Charge no-show fee"}</ConfirmSubmit>
    </form>
  );
}
