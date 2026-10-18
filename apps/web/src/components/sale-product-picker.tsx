"use client";
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type PickerProduct = { id: string; label: string; category: string; priceLabel: string; stock: string | null; out: boolean; imageUrl: string | null };

/**
 * Search-and-tap product list for the checkout. Typing narrows by name, category or barcode-less text; a tap
 * submits the surrounding form with that product (the form also carries the quantity and who gets credit).
 * Posts the choice as a hidden input named `name`.
 */
export function SaleProductPicker({ name = "productId", products, autoFocus }: { name?: string; products: PickerProduct[]; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? products.filter((p) => `${p.label} ${p.category}`.toLowerCase().includes(t)) : products).slice(0, 60);
  }, [q, products]);
  // Grouped by category, as the service list is; "Other" (no category) last.
  const groups = useMemo(() => {
    const by = new Map<string, PickerProduct[]>();
    for (const p of shown) by.set(p.category, [...(by.get(p.category) ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => (a === "Other") === (b === "Other") ? a.localeCompare(b) : a === "Other" ? 1 : -1);
  }, [shown]);
  const oneGroup = groups.length <= 1;
  const pick = (id: string) => {
    if (!input.current) return;
    input.current.value = id;
    input.current.form?.requestSubmit();
  };
  return (
    <div>
      <input ref={input} type="hidden" name={name} />
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the search box adds the only match instead of submitting the quantity form with nothing chosen.
            if (e.key === "Enter") {
              e.preventDefault();
              if (shown.length === 1) pick(shown[0]!.id);
            }
          }}
          autoFocus={autoFocus}
          placeholder="Search products"
          aria-label="Search products"
          className="h-10 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm"
        />
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-stone-200" role="listbox" aria-label="Products">
        {groups.map(([category, list]) => (
          <div key={category} role="group" aria-label={category}>
            {oneGroup ? null : <p className="sticky top-0 border-b border-stone-100 bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{category}</p>}
            <ul className="divide-y divide-stone-100">
              {list.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => pick(p.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-50">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md border border-stone-200 object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.label}</span>
                      {p.stock || oneGroup ? <span className={cn("block truncate text-xs", p.out ? "text-amber-700" : "text-stone-500")}>{[oneGroup ? p.category : null, p.stock].filter(Boolean).join(" · ")}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm">{p.priceLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {shown.length === 0 ? <p className="px-3 py-3 text-sm text-stone-500">No products match &ldquo;{q.trim()}&rdquo;.</p> : null}
      </div>
    </div>
  );
}
