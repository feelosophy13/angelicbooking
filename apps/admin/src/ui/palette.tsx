"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

export type PaletteTenant = { id: string; name: string; slug: string; owner: string | null };

const PAGES = [
  { label: "Dashboard", href: "/" },
  { label: "Businesses", href: "/tenants" },
  { label: "Pricing", href: "/pricing" },
  { label: "Health", href: "/health" },
  { label: "Activity", href: "/activity" },
];

/** ⌘K / Ctrl+K (or the search box): jump to a business or a page. */
export function Palette({ tenants }: { tenants: PaletteTenant[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !n || p.label.toLowerCase().includes(n)).map((p) => ({ key: p.href, title: p.label, sub: "Page", href: p.href }));
    const biz = tenants
      .filter((t) => !n || [t.name, t.slug, t.owner ?? ""].some((s) => s.toLowerCase().includes(n)))
      .slice(0, 8)
      .map((t) => ({ key: t.id, title: t.name, sub: t.owner ?? t.slug, href: `/tenants/${t.id}` }));
    return n ? [...biz, ...pages] : [...pages, ...biz];
  }, [q, tenants]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-3 hover:bg-surface-2" aria-label="Search businesses and pages">
        <Icon name="search" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border border-line px-1.5 text-[11px] sm:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
          <button className="absolute inset-0 bg-black/40" aria-label="Close search" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Icon name="search" className="h-4 w-4 text-ink-3" />
              <input
                ref={input}
                value={q}
                onChange={(e) => { setQ(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                  else if (e.key === "Enter" && results[sel]) go(results[sel]!.href);
                }}
                placeholder="Find a business by name, slug or owner email"
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
              {results.map((r, i) => (
                <li key={r.key} role="option" aria-selected={i === sel}>
                  <button onMouseEnter={() => setSel(i)} onClick={() => go(r.href)} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? "bg-brand-soft text-brand" : ""}`}>
                    <span className="truncate font-medium">{r.title}</span>
                    <span className="truncate text-xs text-ink-3">{r.sub}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
