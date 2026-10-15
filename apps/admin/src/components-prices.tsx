import { FIELDS, inputValue } from "@/lib/price-form";
import type { PriceBook } from "@angelic/core/platform-pricing";

const GROUPS = [...new Set(FIELDS.map((f) => f.group))];

/** Price inputs, in sections. With `defaults` set (per-business override form) a blank box means "use the default" and shows it as the placeholder. */
export function PriceInputs({ values, defaults }: { values: Partial<Record<keyof PriceBook, number | null>>; defaults?: PriceBook }) {
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <fieldset key={g}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{g}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="flex items-center gap-2"><span className="font-medium">{f.label}</span>{defaults && (values[f.key] != null ? <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">custom</span> : <span className="text-[10px] uppercase tracking-wide text-ink-3">default</span>)}</span>
                <span className="block text-xs text-ink-3">{f.help}</span>
                <div className="mt-1 flex items-center rounded-lg border border-line bg-surface focus-within:outline-2 focus-within:outline-brand">
                  {f.kind === "money" && <span className="pl-3 text-ink-3">$</span>}
                  <input
                    name={f.key}
                    inputMode="decimal"
                    defaultValue={inputValue(f, values[f.key])}
                    placeholder={defaults ? inputValue(f, defaults[f.key]) || "0" : undefined}
                    required={!defaults}
                    className="w-full bg-transparent px-3 py-2 outline-none placeholder:text-ink-3"
                  />
                  {f.kind === "percent" && <span className="pr-3 text-ink-3">%</span>}
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
