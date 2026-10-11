"use client";
import { useActionState } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { ConfirmSubmit, SubmitButton } from "@/components/form";
import type { SaleActionState } from "./actions";

type Action = (prev: SaleActionState, fd: FormData) => Promise<SaleActionState>;

export function DiscountForm({ action, slug, saleId, currentCents, current, note }: { action: Action; slug: string; saleId: string; currentCents: number; current: { type: "amount" | "percent"; value: number } | null; note: string | null }) {
  const [state, act, pending] = useActionState(action, undefined);
  const type = current?.type ?? (currentCents > 0 ? "amount" : "none");
  const value = current ? (current.type === "percent" ? String(current.value) : (current.value / 100).toFixed(2)) : currentCents > 0 ? (currentCents / 100).toFixed(2) : "";
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Select name="type" defaultValue={type}>
          <option value="none">No discount</option>
          <option value="amount">$ off</option>
          <option value="percent">% off</option>
        </Select>
        <Input name="value" placeholder="10" defaultValue={value} inputMode="decimal" />
      </div>
      <Input name="note" placeholder="Reason (optional)" defaultValue={note ?? ""} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Apply discount</Button>
    </form>
  );
}

export function TipsForm({ action, slug, saleId, staff, current }: { action: Action; slug: string; saleId: string; staff: { id: string; name: string }[]; current: Record<string, number> }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      {staff.map((s) => (
        <Field key={s.id} label={`Tip for ${s.name}`}>
          <Input name={`tip_${s.id}`} inputMode="decimal" placeholder="0" defaultValue={current[s.id] ? (current[s.id]! / 100).toFixed(2) : ""} />
        </Field>
      ))}
      {staff.length > 1 ? (
        <Field label="Tip on the whole ticket (split by service revenue)">
          <Input name="tip_" inputMode="decimal" placeholder="0" />
        </Field>
      ) : null}
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Save tips</Button>
    </form>
  );
}

export function ManualPayForm({ action, slug, saleId, dueCents }: { action: Action; slug: string; saleId: string; dueCents: number }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Select name="method" defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </Select>
        <Input name="amount" inputMode="decimal" defaultValue={(dueCents / 100).toFixed(2)} />
      </div>
      <Input name="note" placeholder="Note (e.g. Venmo, gift)" />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton size="sm" pendingText="Recording…">Record payment</SubmitButton>
    </form>
  );
}

export function SavedCardForm({ action, slug, saleId, dueCents, cards }: { action: Action; slug: string; saleId: string; dueCents: number; cards: { id: string; brand: string; last4: string; expMonth: number; expYear: number }[] }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <Select name="paymentMethodId" defaultValue={cards[0]?.id}>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>{c.brand.toUpperCase()} •••• {c.last4} ({c.expMonth}/{String(c.expYear).slice(2)})</option>
        ))}
      </Select>
      <Input name="amount" inputMode="decimal" defaultValue={(dueCents / 100).toFixed(2)} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton size="sm" pendingText="Charging…">Charge saved card</SubmitButton>
    </form>
  );
}

export function RefundForm({ action, slug, saleId, paymentId, maxCents }: { action: Action; slug: string; saleId: string; paymentId: string; maxCents: number }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <Input name="amount" inputMode="decimal" defaultValue={(maxCents / 100).toFixed(2)} className="w-28" />
      <Input name="reason" placeholder="Reason" className="w-40" />
      <ConfirmSubmit title="Issue this refund?" body="Card refunds go back to the original card through Stripe and can't be reversed." confirmLabel="Refund" variant="danger">Refund</ConfirmSubmit>
      {state?.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}

export function GiftCardPayForm({ action, slug, saleId, dueCents }: { action: Action; slug: string; saleId: string; dueCents: number }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Input name="code" placeholder="Gift card code" className="font-mono uppercase" required />
        <Input name="amount" inputMode="decimal" defaultValue={(dueCents / 100).toFixed(2)} />
      </div>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "…" : "Redeem gift card"}</Button>
    </form>
  );
}

export function PointsPayForm({ action, slug, saleId, balance, pointValueCents, dueCents, minPoints }: { action: Action; slug: string; saleId: string; balance: number; pointValueCents: number; dueCents: number; minPoints: number }) {
  const [state, act, pending] = useActionState(action, undefined);
  const max = Math.min(balance, Math.floor(dueCents / Math.max(1, pointValueCents)));
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <p className="text-xs text-stone-500">{balance.toLocaleString()} points available · 1 point = {(pointValueCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · minimum {minPoints}</p>
      <Input name="points" type="number" min={minPoints} max={max} defaultValue={max >= minPoints ? max : minPoints} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending || max < minPoints}>{pending ? "…" : "Redeem points"}</Button>
    </form>
  );
}

export function PromoForm({ action, slug, saleId, applied, removeAction }: { action: Action; slug: string; saleId: string; applied: string | null; removeAction: (fd: FormData) => Promise<void> }) {
  const [state, act, pending] = useActionState(action, undefined);
  if (applied) {
    return (
      <form action={removeAction} className="flex items-center justify-between gap-2 text-sm">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="saleId" value={saleId} />
        <span>Code <span className="font-mono">{applied}</span> applied</span>
        <Button type="submit" size="sm" variant="secondary">Remove code</Button>
      </form>
    );
  }
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <Input name="code" placeholder="Promo code" className="font-mono uppercase" required />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "…" : "Apply code"}</Button>
    </form>
  );
}
