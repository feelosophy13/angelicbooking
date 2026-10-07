import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui";

export type SetupStep = { key: string; label: string; href: string; done: boolean; hint?: string };

/** Shown on the calendar until a new business has done the basics. */
export function SetupChecklist({ steps, slug }: { steps: SetupStep[]; slug: string }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Finish setting up</h2>
          <p className="text-xs text-stone-500">{done} of {steps.length} done. Each step takes a minute or two.</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-stone-100"><div className="h-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${s.done ? "border-stone-100 text-stone-400" : "border-stone-200 hover:bg-stone-50"}`}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />}
              <span>
                <span className={s.done ? "line-through" : "font-medium"}>{s.label}</span>
                {s.hint && !s.done ? <span className="block text-xs text-stone-500">{s.hint}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-right text-xs text-stone-400"><Link href={`/app/${slug}/settings`} className="underline">All settings</Link></p>
    </Card>
  );
}
