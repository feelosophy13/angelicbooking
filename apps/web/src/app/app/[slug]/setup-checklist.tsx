import Link from "next/link";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { hideSetupChecklist } from "./actions";

export type SetupStep = { key: string; label: string; href: string; done: boolean; hint?: string };

/**
 * Shown on the calendar until a new business has done the basics. One line by
 * default (progress + the next step), the full list on demand, and it can be
 * hidden for good once the owner decides they're done with it.
 */
export function SetupChecklist({ steps, slug }: { steps: SetupStep[]; slug: string }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  return (
    <details className="group mb-4 rounded-xl border border-brand-100 bg-brand-50/60 print:hidden">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-brand-400 transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium text-brand-900">Setting up · {done} of {steps.length} done</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-brand-100"><span className="block h-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
        <span className="text-stone-600">Next: <Link href={next.href} className="font-medium text-brand-700 hover:underline">{next.label}</Link></span>
      </summary>
      <div className="border-t border-brand-100 px-4 py-3">
        <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${s.done ? "text-stone-400" : "hover:bg-white"}`}>
                {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />}
                <span>
                  <span className={s.done ? "line-through" : "font-medium text-stone-800"}>{s.label}</span>
                  {s.hint && !s.done ? <span className="block text-xs text-stone-500">{s.hint}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <form action={hideSetupChecklist} className="mt-2 flex items-center justify-between text-xs text-stone-500">
          <input type="hidden" name="slug" value={slug} />
          <Link href={`/app/${slug}/settings`} className="underline">All settings</Link>
          <button type="submit" className="underline hover:text-stone-800">Hide this checklist</button>
        </form>
      </div>
    </details>
  );
}
