"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { logUsageQuick } from "../actions";

export type UsageProduct = { id: string; label: string; category: string | null; kind: string; onHand: number; tracked: boolean };

/**
 * Find a product by typing part of its name (or category) and log using one with a single press. With nothing typed it shows what this
 * person logged most recently, because that is usually what they log again. Whole units, one product at a time.
 */
export function UsageSearch({ slug, products, recentIds, locations, defaultLocationId }: { slug: string; products: UsageProduct[]; recentIds: string[]; locations: { id: string; name: string }[]; defaultLocationId: string }) {
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState(defaultLocationId);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (needle) return products.filter((p) => `${p.label} ${p.category ?? ""}`.toLowerCase().includes(needle)).slice(0, 30);
    const recent = recentIds.map((id) => products.find((p) => p.id === id)).filter((p): p is UsageProduct => !!p);
    return recent.length ? recent : products.slice(0, 8);
  }, [needle, products, recentIds]);
  const heading = needle ? `${shown.length} match${shown.length === 1 ? "" : "es"}${shown.length === 30 ? " (showing the first 30)" : ""}` : recentIds.length ? "You logged these recently" : "Start typing to find a product";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" autoComplete="off" autoFocus className="h-10 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm focus:outline-2 focus:outline-brand-500" />
        </div>
        {locations.length > 1 ? (
          <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Where" className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : null}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{heading}</p>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500">No product matches “{q}”.</p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {shown.map((p) => (
            <li key={p.id}>
              <form action={logUsageQuick} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="productId" value={p.id} />
                <input type="hidden" name="locationId" value={loc} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium text-stone-900">{p.label}</p>
                  <p className="truncate text-xs text-stone-500">{[p.category, p.tracked ? `${p.onHand} on hand` : null].filter(Boolean).join(" · ")}</p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-stone-500">
                  Units
                  <input name="qty" type="number" min={1} defaultValue={1} inputMode="numeric" aria-label={`Units of ${p.label} used`} className="h-10 w-16 rounded-lg border border-stone-300 px-2 text-right text-sm" />
                </label>
                <button type="submit" className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Log</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
