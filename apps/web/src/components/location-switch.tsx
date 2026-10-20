"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, MapPin, Search } from "lucide-react";
import { locationControlFor, siteLabels } from "@/lib/location-ui";
import { cn } from "@/lib/utils";

/**
 * The location control for list, report and calendar pages. Up to three sites it is a row of
 * buttons; from four it is one dropdown showing the current site, with "All" on top and, from
 * eight, a search box. Every choice is a link that sets `location=` and keeps `query`.
 */
export function LocationSwitch({ locations, current, query, allLabel = "All locations" }: { locations: { id: string; name: string }[]; current: string | null; query: string; /** `null` removes the "All" choice, for pages where only one site at a time makes sense. */ allLabel?: string | null }) {
  const kind = locationControlFor(locations.length);
  const labels = siteLabels(locations);
  const href = (id: string | null) => `?${query}${query ? "&" : ""}location=${id ?? ""}`;
  if (kind === "none") return null;
  if (kind === "buttons") {
    return (
      <div data-segmented className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Location">
        {allLabel !== null ? <Link href={href(null)} className={cn("rounded-md px-3 py-1", current === null ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>{allLabel}</Link> : null}
        {locations.map((l) => (
          <Link key={l.id} href={href(l.id)} className={cn("rounded-md px-3 py-1", current === l.id ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")} title={l.name}>{labels.get(l.id)}</Link>
        ))}
      </div>
    );
  }
  return <Menu locations={locations} labels={labels} current={current} href={href} allLabel={allLabel} search={kind === "menu-search"} />;
}

function Menu({ locations, labels, current, href, allLabel, search }: { locations: { id: string; name: string }[]; labels: Map<string, string>; current: string | null; href: (id: string | null) => string; allLabel: string | null; search: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Open toward the side with room: the control sits at the left of some headers and the right of others.
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = () => {
    if (!open && root.current) {
      const r = root.current.getBoundingClientRect();
      setAlignRight(r.left + 256 > window.innerWidth - 16);
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? locations.filter((l) => l.name.toLowerCase().includes(needle)) : locations;
  const currentLabel = current ? labels.get(current) ?? "Location" : (allLabel ?? "Location");
  const row = (id: string | null, label: string, title?: string) => (
    <li key={id ?? "all"}>
      <Link href={href(id)} onClick={() => { setOpen(false); setQ(""); }} title={title} className={cn("flex items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-stone-50", current === id && "font-medium text-stone-900")}>
        <span className="truncate">{label}</span>
        {current === id ? <Check className="h-4 w-4 shrink-0 text-brand-700" aria-hidden /> : null}
      </Link>
    </li>
  );
  return (
    <div ref={root} className="relative">
      <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={`Location: ${currentLabel}`} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-sm", current ? "text-stone-900" : "text-stone-700", "hover:bg-stone-50")}>
        <MapPin className="h-4 w-4 text-stone-400" aria-hidden />
        <span className="max-w-[12rem] truncate">{currentLabel}</span>
        <ChevronDown className={cn("h-4 w-4 text-stone-400 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className={cn("absolute z-30 mt-1 w-64 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg", alignRight ? "right-0" : "left-0")}>
          {search ? (
            <div className="relative border-b border-stone-100 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a location" aria-label="Find a location" className="h-8 w-full rounded-md border border-stone-300 pl-8 pr-2 text-sm" />
            </div>
          ) : null}
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Locations">
            {!needle && allLabel !== null ? row(null, allLabel) : null}
            {shown.map((l) => row(l.id, labels.get(l.id) ?? l.name, l.name))}
            {shown.length === 0 ? <li className="px-3 py-2 text-sm text-stone-500">No location matches “{q}”.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
