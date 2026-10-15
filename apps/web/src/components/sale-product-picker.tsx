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
      <ul className="max-h-72 divide-y divide-stone-100 overflow-auto rounded-lg border border-stone-200" role="listbox" aria-label="Products">
        {shown.map((p) => (
          <li key={p.id} role="option" aria-selected={false}>
            <button type="button" onClick={() => pick(p.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-50">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md border border-stone-200 object-cover" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.label}</span>
                <span className={cn("block truncate text-xs", p.out ? "text-amber-700" : "text-stone-500")}>{[p.category, p.stock].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="shrink-0 text-sm">{p.priceLabel}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-3 text-sm text-stone-500">No products match &ldquo;{q.trim()}&rdquo;.</li> : null}
      </ul>
    </div>
  );
}
