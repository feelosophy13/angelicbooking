"use client";
import { useState } from "react";
import { closeNeedsNote, countDenominations, DENOMINATIONS, OVER_SHORT_NOTE_CENTS } from "@angelic/core";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Input, MoneyInput, Select, Textarea } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { Segmented } from "../sales/[saleId]/forms";
import { cn, formatMoney } from "@/lib/utils";
import { closeDrawerAction, correctDrawerAction, drawerMovementAction, openDrawerAction } from "./actions";

const toCents = (v: string) => (/^\$?\d{1,7}(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v.trim().replace("$", "")) * 100) : null);

export function OpenDrawerForm({ slug, locationId, currency, suggestedFloatCents, showRegister }: { slug: string; locationId: string; currency: string; suggestedFloatCents: number | null; showRegister: boolean }) {
  return (
    <ActionForm action={openDrawerAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locationId" value={locationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starting float" name="float" required hint={suggestedFloatCents != null ? `Last close counted ${formatMoney(suggestedFloatCents, currency)}.` : "The cash in the drawer before the first sale."}>
          <MoneyInput name="float" currency={currency.toUpperCase()} defaultValue={suggestedFloatCents != null ? (suggestedFloatCents / 100).toFixed(2) : ""} />
        </Field>
        {showRegister ? (
          <Field label="Register" name="register" hint="Only when this site runs more than one drawer.">
            <Input name="register" placeholder="Main" maxLength={40} />
          </Field>
        ) : null}
      </div>
      <SubmitButton pendingText="Opening…">Open drawer</SubmitButton>
    </ActionForm>
  );
}

type Kind = "pay_in" | "payout" | "tip_payout";

export function MovementForm({ slug, sessionId, currency, staff }: { slug: string; sessionId: string; currency: string; staff: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<Kind>("payout");
  return (
    <ActionForm action={drawerMovementAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="kind" value={kind} />
      <Segmented label="Cash in or out" value={kind} onChange={setKind} options={[{ value: "payout", label: "Payout" }, { value: "pay_in", label: "Pay-in" }, ...(staff.length ? [{ value: "tip_payout" as const, label: "Tip paid out" }] : [])]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" name="amount" required>
          <MoneyInput name="amount" currency={currency.toUpperCase()} />
        </Field>
        {kind === "tip_payout" ? (
          <Field label="Paid to" name="staffId" required hint="Taken off their next pay sheet as already paid, so payroll doesn't pay it twice.">
            <Select name="staffId" defaultValue="">
              <option value="" disabled>Choose a person</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Reason" name="reason" required className={kind === "tip_payout" ? "sm:col-span-2" : undefined}>
          <Input name="reason" maxLength={120} defaultValue={kind === "tip_payout" ? "Cash tip" : undefined} key={kind} placeholder={kind === "pay_in" ? "Change run, float top-up" : kind === "payout" ? "Petty cash, supplies, bank drop" : undefined} />
        </Field>
      </div>
      <SubmitButton variant="secondary" pendingText="Saving…">{kind === "pay_in" ? "Record pay-in" : kind === "payout" ? "Record payout" : "Record tip payout"}</SubmitButton>
    </ActionForm>
  );
}

/** Counted against expected as it is typed, by total or by bill and coin; a difference over the limit asks for a note. */
export function CloseDrawerForm({ slug, sessionId, currency, expectedCents }: { slug: string; sessionId: string; currency: string; expectedCents: number }) {
  const [mode, setMode] = useState<"total" | "denominations">("total");
  const [total, setTotal] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const parsed = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)]));
  const counted = mode === "total" ? toCents(total) : Object.values(counts).some((v) => v.trim()) ? countDenominations(parsed) : null;
  const diff = counted == null ? null : counted - expectedCents;
  const needsNote = diff != null && closeNeedsNote(diff);
  const money = (c: number) => formatMoney(c, currency);
  return (
    <ActionForm action={closeDrawerAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="mode" value={mode} />
      <Segmented label="How to count" value={mode} onChange={setMode} options={[{ value: "total", label: "Total" }, { value: "denominations", label: "By bill and coin" }]} className="sm:max-w-sm" />
      {mode === "total" ? (
        <Field label="Cash counted" name="counted" required>
          <MoneyInput name="counted" currency={currency.toUpperCase()} value={total} onChange={(e) => setTotal(e.target.value)} className="sm:max-w-xs" />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          {DENOMINATIONS.map((d) => (
            <Field key={d.cents} label={d.label} name={`d${d.cents}`}>
              <Input name={`d${d.cents}`} inputMode="numeric" placeholder="0" value={counts[d.cents] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d.cents]: e.target.value.replace(/\D/g, "") }))} />
            </Field>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 rounded-lg border border-stone-200 p-3 text-sm">
        <div>
          <dt className="text-stone-500">Expected</dt>
          <dd className="font-medium tabular-nums">{money(expectedCents)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Counted</dt>
          <dd className="font-medium tabular-nums">{counted == null ? "—" : money(counted)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Over / short</dt>
          <dd className={cn("font-semibold tabular-nums", diff == null ? "" : diff === 0 ? "text-emerald-700" : needsNote ? "text-red-700" : "text-amber-700")} data-testid="over-short">
            {diff == null ? "—" : diff === 0 ? "Balances" : `${money(Math.abs(diff))} ${diff > 0 ? "over" : "short"}`}
          </dd>
        </div>
      </dl>
      {needsNote ? (
        <Field label="What happened?" name="note" required hint={`Needed when the count is off by more than ${money(OVER_SHORT_NOTE_CENTS)}.`}>
          <Textarea name="note" rows={2} />
        </Field>
      ) : (
        <Disclosure variant="plain" title="Add a note">
          <Field label="Note" name="note">
            <Textarea name="note" rows={2} />
          </Field>
        </Disclosure>
      )}
      <SubmitButton pendingText="Closing…">Close drawer</SubmitButton>
    </ActionForm>
  );
}

/**
 * Correct a drawer after closing: a recount and/or something missed while it was open. Opens on demand; the reason is required and
 * goes on the close note and in the activity log.
 */
export function CorrectDrawerForm({ slug, sessionId, currency, countedCents, staff }: { slug: string; sessionId: string; currency: string; countedCents: number | null; staff: { id: string; name: string }[] }) {
  const [missed, setMissed] = useState<"" | "pay_in" | "payout" | "tip_payout">("");
  return (
    <Disclosure title="Correct this close-out" hint="recount or something missed">
      <ActionForm action={correctDrawerAction} onReset={() => setMissed("")}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="sessionId" value={sessionId} />
        <Field label="Counted" name="counted" hint={`Leave as is to keep ${countedCents != null ? formatMoney(countedCents, currency) : "the count"}.`}>
          <MoneyInput name="counted" currency={currency.toUpperCase()} defaultValue={countedCents != null ? (countedCents / 100).toFixed(2) : ""} />
        </Field>
        <Field label="Missed while it was open" name="missedKind">
          <Select name="missedKind" value={missed} onChange={(e) => setMissed(e.target.value as typeof missed)}>
            <option value="">Nothing</option>
            <option value="payout">A payout</option>
            <option value="pay_in">A pay-in</option>
            <option value="tip_payout">A tip paid out</option>
          </Select>
        </Field>
        {missed ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" name="missedAmount" required><MoneyInput name="missedAmount" currency={currency.toUpperCase()} /></Field>
            {missed === "tip_payout" ? (
              <Field label="Paid to" name="missedStaffId" required hint="Taken off their pay sheet for that day's period.">
                <Select name="missedStaffId" defaultValue=""><option value="" disabled>Choose a person</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              </Field>
            ) : (
              <Field label="What it was" name="missedReason"><Input name="missedReason" maxLength={120} placeholder={missed === "pay_in" ? "Change run" : "Supplies"} /></Field>
            )}
          </div>
        ) : null}
        <Field label="Why it's being corrected" name="reason" required><Textarea name="reason" rows={2} maxLength={300} placeholder="Recounted the next morning: a $20 was stuck in the tray." /></Field>
        <SubmitButton variant="secondary" pendingText="Saving…">Save correction</SubmitButton>
      </ActionForm>
    </Disclosure>
  );
}
