"use client";

import { useActionState } from "react";
import type { PriceBook } from "@angelic/core/platform-pricing";
import { PriceInputs } from "./components-prices";
import { saveBusinessOverrides, saveDefaults, type FormState } from "@/app/pricing/actions";

function Result({ state }: { state: FormState }) {
  if (state?.errors) return <ul role="alert" className="text-sm text-red-700">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>;
  if (state?.ok) return <p role="status" className="text-sm text-emerald-700">Saved.</p>;
  return null;
}

const BUTTON = "rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60";

export function DefaultsForm({ values }: { values: PriceBook }) {
  const [state, action, pending] = useActionState(saveDefaults, null);
  return (
    <form action={action} className="space-y-4">
      <PriceInputs values={values} />
      <Result state={state} />
      <button disabled={pending} className={BUTTON}>{pending ? "Saving…" : "Save price book"}</button>
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
        <span className="ml-2 text-xs text-stone-500">Why this business has a custom price</span>
        <textarea name="note" defaultValue={note ?? ""} rows={2} maxLength={500} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" />
      </label>
      <Result state={state} />
      <button disabled={pending} className={BUTTON}>{pending ? "Saving…" : "Save custom pricing"}</button>
    </form>
  );
}
