"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/form";
import { importProductSheet, type ImportState } from "./actions";

export function ImportForm({ slug }: { slug: string }) {
  const [state, act] = useActionState<ImportState, FormData>(importProductSheet, undefined);
  const s = state?.summary;
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="file" name="file" accept=".csv,.xlsx,.xls,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm" />
      <label className="flex items-start gap-2 text-sm text-stone-700">
        <input type="checkbox" name="dryRun" defaultChecked className="mt-0.5 h-4 w-4" />
        <span>Only check the file first<span className="block text-xs text-stone-500">Shows what would be added and changed, without touching anything. Untick it to import for real.</span></span>
      </label>
      {state?.error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div> : null}
      {s ? (
        <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${state?.dryRun ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p className="font-medium">{state?.dryRun ? "Checked. Nothing has changed yet." : "Imported."}</p>
          <p>{state?.dryRun ? "Would add" : "Added"} {s.created} new, {state?.dryRun ? "update" : "updated"} {s.updated}, {state?.dryRun ? "set" : "set"} {s.counted} stock count{s.counted === 1 ? "" : "s"}.</p>
          {state?.problems?.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs">{state.problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}{state.problems.length > 20 ? <li>…and {state.problems.length - 20} more</li> : null}</ul>
          ) : null}
        </div>
      ) : null}
      <SubmitButton pendingText="Reading…">Check or import</SubmitButton>
    </form>
  );
}
