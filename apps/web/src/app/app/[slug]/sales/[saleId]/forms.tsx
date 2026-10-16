"use client";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Button, Field, Input, Notice, Select, MoneyInput } from "@/components/ui";
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

export function TipsForm({ action, slug, saleId, staff, current, currentMethods = {}, baseCents, choices = [], currency = "USD" }: { action: Action; slug: string; saleId: string; staff: { id: string; name: string }[]; current: Record<string, number>; /** How each tip already on the ticket was handed over ("" = same as the payment). */ currentMethods?: Record<string, "cash" | "card" | "">; /** Everyone who could receive a tip, offered when nobody is credited on the ticket yet (a products-only sale). */ choices?: { id: string; name: string }[]; /** What a percentage tip is worked out on: the goods after any discount, before tax. */ baseCents: number; currency?: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const initial: Record<string, string> = {};
  // No default person: a tip nobody is credited for has to be given to someone on purpose.
  const [who, setWho] = useState("");
  const nobody = staff.length === 0;
  for (const x of staff) initial[x.id] = current[x.id] ? (current[x.id]! / 100).toFixed(2) : "";
  initial[""] = "";
  const [vals, setVals] = useState(initial);
  // How each tip is handed over: cash or card, or "same as the payment" (payroll then splits it by how the sale was paid).
  const [by, setBy] = useState<Record<string, string>>({ ...currentMethods });
  const setMethod = (k: string, v: string) => setBy((m) => ({ ...m, [k]: v }));
  const tipBy = (k: string) => (
    <Field label="Paid in">
      <Select name={`tipby_${k}`} value={by[k] ?? ""} onChange={(e) => setMethod(k, e.target.value)} aria-label="How this tip is paid">
        <option value="">Same as sale</option>
        <option value="card">Card</option>
        <option value="cash">Cash</option>
      </Select>
    </Field>
  );
  // One person: the preset fills their field; several: it fills the whole-ticket field, which is split by who earned the revenue.
  const target = staff.length === 1 ? staff[0]!.id : "";
  const fill = (pct: number) => setVals((v) => {
    const next: Record<string, string> = {};
    for (const k of Object.keys(v)) next[k] = "";
    next[target] = pct ? ((Math.round((baseCents * pct) / 100)) / 100).toFixed(2) : "";
    return next;
  });
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      {baseCents > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tip presets">
          {[0, 15, 20, 25].map((pct) => (
            <button key={pct} type="button" onClick={() => fill(pct)} className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-sm hover:bg-stone-50">
              {pct ? <>{pct}% <span className="text-xs text-stone-500">{money(Math.round((baseCents * pct) / 100))}</span></> : "No tip"}
            </button>
          ))}
        </div>
      ) : null}
      {staff.map((s) => (
        <div key={s.id} className="grid grid-cols-[1fr_9.5rem] gap-2">
          <Field label={`Tip for ${s.name}`}>
            <Input name={`tip_${s.id}`} inputMode="decimal" placeholder="0" value={vals[s.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))} />
          </Field>
          {tipBy(s.id)}
        </div>
      ))}
      {nobody && choices.length ? (
        <div className="grid grid-cols-[1fr_7rem_9.5rem] gap-2">
          <Field label="Tip for">
            <Select value={who} required={(vals[""] ?? "").trim() !== ""} onChange={(e) => { setWho(e.target.value); }}>
              <option value="" disabled>Choose who…</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Amount"><MoneyInput name={who ? `tip_${who}` : undefined} value={vals[""] ?? ""} onChange={(e) => setVals((v) => ({ ...v, "": e.target.value }))} /></Field>
          {tipBy(who)}
        </div>
      ) : staff.length > 1 ? (
        <div className="grid grid-cols-[1fr_9.5rem] gap-2">
          <Field label="Tip on the whole ticket (split by who earned the revenue)">
            <MoneyInput name="tip_" value={vals[""] ?? ""} onChange={(e) => setVals((v) => ({ ...v, "": e.target.value }))} />
          </Field>
          {tipBy("")}
        </div>
      ) : null}
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Save tips</Button>
    </form>
  );
}

export function ManualPayForm({ action, slug, saleId, dueCents, currency = "USD" }: { action: Action; slug: string; saleId: string; dueCents: number; currency?: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [tendered, setTendered] = useState("");
  const toCents = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
  const pay = toCents(amount);
  const given = toCents(tendered);
  const change = method === "cash" && tendered.trim() !== "" && Number.isFinite(given) && Number.isFinite(pay) ? given - pay : null;
  // Bills a customer is likely to hand over: the exact amount, then the next round notes above it.
  const quick = [...new Set([pay, ...[5, 10, 20, 50, 100].map((n) => n * 100).filter((n) => n > pay)].filter((n) => Number.isFinite(n) && n > 0))].slice(0, 4);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </Select>
        <MoneyInput name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {method === "cash" ? (
        <div className="space-y-1.5 rounded-lg bg-stone-50 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-stone-500">Cash received</span>
            {quick.map((c) => (
              <button key={c} type="button" onClick={() => setTendered((c / 100).toFixed(2))} className="rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100">{c === pay ? "Exact" : money(c)}</button>
            ))}
          </div>
          <MoneyInput name="tendered" value={tendered} onChange={(e) => setTendered(e.target.value)} aria-label="Cash received" />
          {change !== null ? (
            change >= 0 ? <p className="text-sm font-medium">Change due: <span className="text-brand-700">{money(change)}</span></p> : <p className="text-sm text-red-700">{money(-change)} short</p>
          ) : null}
        </div>
      ) : null}
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
      <MoneyInput name="amount" defaultValue={(dueCents / 100).toFixed(2)} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton size="sm" pendingText="Charging…">Charge saved card</SubmitButton>
    </form>
  );
}

/**
 * Refund a payment. "Original payment" reverses it (card through Stripe, cash handed back); "Store
 * credit" keeps the money and gives the client a balance to spend later (needs a client on the ticket).
 */
export type ReasonOption = { id: string; name: string };

export type RefundLineOption = { id: string; name: string; kind: string; quantity: number; remainingCents: number };

export function RefundForm({ action, slug, saleId, paymentId, maxCents, creditAllowed, reasons, goods = [], items = [] }: { action: Action; slug: string; saleId: string; paymentId: string; maxCents: number; creditAllowed: boolean; reasons: ReasonOption[]; /** Products this sale took off the shelf that haven't come back, so a returned item can go back on it. */ goods?: { productId: string; name: string; left: number }[]; /** Ticket lines with money left to refund: choosing them refunds exactly those (and takes exactly them back from the stylist's pay). */ items?: RefundLineOption[] }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [to, setTo] = useState<"original" | "store_credit">("original");
  // lineId → amount typed (dollars) and how many; a line is chosen when it has an amount.
  const [picked, setPicked] = useState<Record<string, { amount: string; qty: number }>>({});
  // A form action resets the checkboxes in the page but not this state: redraw them from it after every reply.
  const [drawn, setDrawn] = useState(0);
  useEffect(() => setDrawn((n) => n + 1), [state]);
  const chosen = Object.entries(picked).filter(([, v]) => v.amount.trim() !== "");
  const totalCents = chosen.reduce((n, [, v]) => n + Math.round((Number(v.amount) || 0) * 100), 0);
  const toggle = (l: RefundLineOption, on: boolean) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (on) next[l.id] = { amount: (l.remainingCents / 100).toFixed(2), qty: l.quantity };
      else delete next[l.id];
      return next;
    });
  return (
    <form action={act} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      {items.length ? (
        <div key={drawn} className="basis-full space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
          <p className="text-xs text-stone-500">What&apos;s being refunded? Pick the items so the right stylist&apos;s pay is adjusted. Leave all unticked to refund an amount off the whole ticket.</p>
          {items.map((l) => {
            const p = picked[l.id];
            return (
              <div key={l.id} className="space-y-1.5">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={!!p} onChange={(e) => toggle(l, e.target.checked)} />
                  <span className="min-w-0 flex-1">{l.name} <span className="whitespace-nowrap text-xs text-stone-500">· up to ${(l.remainingCents / 100).toFixed(2)}</span></span>
                </label>
                {p ? (
                  <div className="flex items-center gap-2 pl-6">
                    {l.quantity > 1 ? (
                      <Select name={`qty:${l.id}`} value={String(p.qty)} onChange={(e) => { const qty = Number(e.target.value); setPicked((c) => ({ ...c, [l.id]: { qty, amount: ((l.remainingCents * qty) / l.quantity / 100).toFixed(2) } })); }} className="w-24" aria-label={`How many ${l.name}`}>
                        {Array.from({ length: l.quantity }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} of {l.quantity}</option>)}
                      </Select>
                    ) : null}
                    <MoneyInput name={`item:${l.id}`} value={p.amount} onChange={(e) => setPicked((c) => ({ ...c, [l.id]: { ...p, amount: e.target.value } }))} className="w-28" aria-label={`Refund for ${l.name}`} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {chosen.length ? (
        <p className="py-2 text-sm font-medium">Refund ${(totalCents / 100).toFixed(2)}{totalCents > maxCents ? <span className="ml-2 font-normal text-red-700">more than the ${(maxCents / 100).toFixed(2)} left on this payment</span> : null}</p>
      ) : (
        <MoneyInput name="amount" defaultValue={(maxCents / 100).toFixed(2)} className="w-28" aria-label="Refund amount" />
      )}
      <Select name="to" value={to} onChange={(e) => setTo(e.target.value as "original" | "store_credit")} className="w-44" aria-label="Refund to">
        <option value="original">To original payment</option>
        <option value="store_credit" disabled={!creditAllowed}>As store credit{creditAllowed ? "" : " (needs a client)"}</option>
      </Select>
      <Select name="reasonId" defaultValue="" required className="w-44" aria-label="Reason">
        <option value="" disabled>Reason…</option>
        {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Input name="note" placeholder="Note (optional)" className="w-40" />
      {goods.length ? (
        <details className="basis-full text-sm">
          <summary className="cursor-pointer select-none text-stone-600 hover:text-stone-900">Did the client bring goods back? Put them back on the shelf</summary>
          <div className="mt-2 space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-3">
            <p className="text-xs text-stone-500">Leave blank when the product is gone (never arrived, goodwill): the stock stays as it is.</p>
            {goods.map((g) => (
              <div key={g.productId} className="grid grid-cols-[1fr_4rem] items-center gap-2">
                <label htmlFor={`refund-back:${paymentId}:${g.productId}`} className="min-w-0 truncate">{g.name} <span className="text-xs text-stone-500">· up to {g.left}</span></label>
                <Input id={`refund-back:${paymentId}:${g.productId}`} name={`back:${g.productId}`} type="number" min={0} max={g.left} placeholder="0" className="text-right" />
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <ConfirmSubmit
        title={to === "store_credit" ? "Refund as store credit?" : "Issue this refund?"}
        body={to === "store_credit" ? "The money stays with you and the client gets the amount as store credit to spend on a future visit." : "Card refunds go back to the original card through Stripe and can't be reversed."}
        confirmLabel={to === "store_credit" ? "Give store credit" : "Refund"}
        variant={to === "store_credit" ? "primary" : "danger"}
      >
        {to === "store_credit" ? "Give credit" : "Refund"}
      </ConfirmSubmit>
      {state?.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}

/** Change the reason or note on a refund already made. Opens on demand under the refund line. */
export function RefundReasonEditor({ action, slug, saleId, kind, id, reasonId, note, reasons }: { action: Action; slug: string; saleId: string; kind: "refund" | "credit"; id: string; reasonId: string | null; note: string | null; reasons: ReasonOption[] }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="ml-2 text-xs text-brand-700 underline">Edit reason</button>;
  return (
    <form action={act} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <Select name="reasonId" defaultValue={reasonId ?? ""} className="h-8 w-44 text-xs" aria-label="Reason">
        <option value="">No reason</option>
        {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Input name="note" defaultValue={note ?? ""} placeholder="Note (optional)" className="h-8 w-40 text-xs" aria-label="Note" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone-500 underline">Cancel</button>
      {state?.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}

/** Spend the client's store credit on the ticket. */
export function StoreCreditPayForm({ action, slug, saleId, balanceCents, dueCents }: { action: Action; slug: string; saleId: string; balanceCents: number; dueCents: number }) {
  const [state, act, pending] = useActionState(action, undefined);
  const max = Math.min(balanceCents, dueCents);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <p className="text-xs text-stone-500">{(balanceCents / 100).toFixed(2)} available.</p>
      <MoneyInput name="amount" defaultValue={(max / 100).toFixed(2)} aria-label="Store credit to apply" />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton size="sm" pendingText="Applying…">Apply store credit</SubmitButton>
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
        <MoneyInput name="amount" defaultValue={(dueCents / 100).toFixed(2)} />
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

/** Send the receipt of a paid sale by email or text, to the client's details or anything typed in. */
export function SendReceiptForm({ action, slug, saleId, email, phone }: { action: (fd: FormData) => Promise<void>; slug: string; saleId: string; email: string | null; phone: string | null }) {
  const [channel, setChannel] = useState<"email" | "sms">(email || !phone ? "email" : "sms");
  const [to, setTo] = useState(email ?? phone ?? "");
  const pick = (c: "email" | "sms") => { setChannel(c); setTo(c === "email" ? (email ?? "") : (phone ?? "")); };
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="channel" value={channel} />
      <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Send the receipt by">
        {([["email", "Email"], ["sms", "Text"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => pick(k)} aria-pressed={channel === k} className={`flex-1 rounded-md px-3 py-1 ${channel === k ? "bg-stone-900 text-white" : "text-stone-700"}`}>{l}</button>
        ))}
      </div>
      <Input name="to" type={channel === "email" ? "email" : "tel"} value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === "email" ? "name@example.com" : "Mobile number"} required aria-label={channel === "email" ? "Email address" : "Mobile number"} />
      <SubmitButton size="sm" variant="secondary" pendingText="Sending…">Send receipt</SubmitButton>
    </form>
  );
}

/** A private note on the ticket (not printed on the receipt). */
export function SaleNoteForm({ action, slug, saleId, notes }: { action: Action; slug: string; saleId: string; notes: string | null }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <textarea name="notes" rows={2} maxLength={1000} defaultValue={notes ?? ""} placeholder="Private note, e.g. gift for Maria, price matched" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" aria-label="Note on this sale" />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{state?.ok ? "Saved" : "Save note"}</Button>
    </form>
  );
}

/** Add a tip to a sale that is already paid: cash, or a card the client has on file. */
export function LateTipForm({ action, slug, saleId, staff, cards }: { action: Action; slug: string; saleId: string; staff: { id: string; name: string }[]; cards: { id: string; brand: string; last4: string }[] }) {
  const [state, act, pending] = useActionState(action, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      <Field label="Tip for">
        <Select name="staffId" defaultValue="" required>
          <option value="" disabled>Choose who…</option>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Amount"><MoneyInput name="amount" required /></Field>
        <Field label="Paid in">
          <Select name="paidIn" defaultValue="cash">
            <option value="cash">Cash</option>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.brand.toUpperCase()} •••• {c.last4} (charged now)</option>)}
          </Select>
        </Field>
      </div>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      {state?.ok ? <p className="text-xs text-emerald-700">Tip added.</p> : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Add tip</Button>
    </form>
  );
}
