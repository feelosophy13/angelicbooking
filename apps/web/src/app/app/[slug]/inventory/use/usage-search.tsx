"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { Search, Star } from "lucide-react";
import { logUsageQuick, togglePinAction } from "../actions";
import { cn } from "@/lib/utils";

export type UsageProduct = { id: string; label: string; category: string | null; kind: string; onHand: number; tracked: boolean; barcode: string | null; sku: string | null };

/**
 * Find a product and log using one with a single press. The search matches name, category, barcode and SKU; a scanned code (or a search
 * with one result) logs when you press Enter, then the box clears for the next one. Starred products stay at the top, per person, then what
 * this person logged recently. Whole units, one product at a time.
 */
export function UsageSearch({ slug, products, pinnedIds, recentIds, locations, defaultLocationId }: { slug: string; products: UsageProduct[]; pinnedIds: string[]; recentIds: string[]; locations: { id: string; name: string }[]; defaultLocationId: string }) {
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState(defaultLocationId);
  const [cat, setCat] = useState("");
  const [pins, setPins] = useState(() => new Set(pinnedIds));
  const [busy, start] = useTransition();
  const search = useRef<HTMLInputElement>(null);
  const needle = q.trim().toLowerCase();
  const categories = useMemo(() => [...new Set(products.map((p) => p.category ?? "Other"))], [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const filtering = !!(needle || cat);
  const matches = useMemo(
    () => (filtering ? products.filter((p) => (!cat || (p.category ?? "Other") === cat) && (!needle || [p.label, p.category, p.barcode, p.sku].some((v) => v?.toLowerCase().includes(needle)))).slice(0, 50) : []),
    [filtering, needle, cat, products],
  );
  const pinned = useMemo(() => pinnedIds.concat([...pins].filter((id) => !pinnedIds.includes(id))).filter((id) => pins.has(id)).map((id) => byId.get(id)).filter((p): p is UsageProduct => !!p), [pins, pinnedIds, byId]);
  const recent = useMemo(() => recentIds.filter((id) => !pins.has(id)).map((id) => byId.get(id)).filter((p): p is UsageProduct => !!p), [recentIds, pins, byId]);

  // Log one product; clear the box and keep the focus so a scanner (or the next search) can go straight on.
  const log = (productId: string, qty: string) => {
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("productId", productId);
    fd.set("locationId", loc);
    fd.set("qty", qty);
    start(async () => {
      await logUsageQuick(fd);
      setQ("");
      search.current?.focus();
    });
  };
  const flip = (id: string) => {
    setPins((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("productId", id);
    start(async () => {
      await togglePinAction(fd);
    });
  };
  const onEnter = () => {
    if (!needle) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === needle || p.sku?.toLowerCase() === needle);
    const target = exact ?? (matches.length === 1 ? matches[0] : null);
    if (target) log(target.id, "1");
  };

  const Row = ({ p }: { p: UsageProduct }) => {
    let qtyInput: HTMLInputElement | null = null;
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
        <button type="button" onClick={() => flip(p.id)} aria-pressed={pins.has(p.id)} aria-label={pins.has(p.id) ? `Unpin ${p.label}` : `Pin ${p.label} to the top`} className="-m-1 rounded p-1 text-stone-300 hover:text-amber-500 aria-pressed:text-amber-500">
          <Star className={cn("h-5 w-5", pins.has(p.id) && "fill-current")} />
        </button>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium text-stone-900">{p.label}</p>
          <p className="truncate text-xs text-stone-500">{[p.category, p.tracked ? `${p.onHand} on hand` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Units
            <input ref={(el) => { qtyInput = el; }} type="number" min={1} defaultValue={1} inputMode="numeric" aria-label={`Units of ${p.label} used`} className="h-11 w-16 rounded-lg border border-stone-300 px-2 text-right text-sm" />
          </label>
          <button type="button" disabled={busy} onClick={() => log(p.id, qtyInput?.value || "1")} className="h-11 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">Log</button>
        </div>
      </li>
    );
  };
  const Group = ({ title, items }: { title: string; items: UsageProduct[] }) =>
    items.length ? (
      <section className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{title}</p>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">{items.map((p) => <Row key={p.id} p={p} />)}</ul>
      </section>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 bg-stone-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-stone-400" aria-hidden />
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            }}
            placeholder="Search or scan"
            aria-label="Search products"
            autoComplete="off"
            enterKeyHint="go"
            autoFocus
            className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm focus:outline-2 focus:outline-brand-500"
          />
        </div>
        {categories.length > 1 ? (
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : null}
        {locations.length > 1 ? (
          <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Where" className="h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : null}
      </div>

      {filtering ? (
        matches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500">No product matches{q ? ` “${q}”` : ""}{cat ? ` in ${cat}` : ""}.</p>
        ) : (
          <Group title={`${matches.length} match${matches.length === 1 ? "" : "es"}${matches.length === 50 ? " (showing the first 50)" : ""}${matches.length === 1 && needle ? " · press Enter to log 1" : ""}`} items={matches} />
        )
      ) : (
        <>
          <Group title="Pinned" items={pinned} />
          <Group title="You logged these recently" items={recent} />
          {!pinned.length && !recent.length ? <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500">Search for a product, or pick a category. Press the star on a product to keep it here.</p> : null}
          {pinned.length || recent.length ? <p className="text-xs text-stone-500">Star a product to keep it at the top.</p> : null}
        </>
      )}
    </div>
  );
}
