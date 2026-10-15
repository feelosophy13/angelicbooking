"use client";

import { useActionState } from "react";
import type { PriceBook } from "@angelic/core/platform-pricing";
import { PriceInputs } from "./components-prices";
import { BTN_PRIMARY, INPUT } from "@/ui/kit";
import { saveBusinessOverrides, saveDefaults, type FormState } from "@/app/pricing/actions";

function Result({ state }: { state: FormState }) {
  if (state?.errors) return <ul role="alert" className="text-sm text-bad">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>;
  if (state?.ok) return <p role="status" className="text-sm text-good">Saved.</p>;
  return null;
}

const BUTTON = BTN_PRIMARY;

export function DefaultsForm({ values }: { values: PriceBook }) {
  const [state, action, pending] = useActionState(saveDefaults, null);
  return (
    <form action={action} className="space-y-4">
      <PriceInputs values={values} />
      <Result state={state} />
      <button disabled={pending} className={BUTTON}>{pending ? "Saving…" : "Save default prices"}</button>
    </form>
  );
}

export function OverridesForm({ businessId, values, defaults, note }: { businessId: string; values: Partial<Record<keyof PriceBook, number | null>>; defaults: PriceBook; note: string | null }) {
  const [state, action, pending] = useActionState(saveBusinessOverrides.bind(null, businessId), null);
  return (
    <form action={action} className="space-y-4">
      <PriceInputs values={values} defaults={defaults} />
      <label className="block text-sm">
        <span className="font-medium">Note</span>
        <span className="ml-2 text-xs text-ink-3">Why this business has a custom price</span>
        <textarea name="note" defaultValue={note ?? ""} rows={2} maxLength={500} className={`${INPUT} mt-1`} />
      </label>
      <Result state={state} />
      <button disabled={pending} className={BUTTON}>{pending ? "Saving…" : "Save custom pricing"}</button>
    </form>
  );
}
