"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, CalendarPlus, ChevronDown, Plus, Receipt, UserPlus } from "lucide-react";

export type NewItem = { href: string; label: string; hint: string; icon: "appointment" | "sale" | "client" | "block" };

const ICONS = { appointment: CalendarPlus, sale: Receipt, client: UserPlus, block: Ban };

/**
 * "+ New" at the top of the sidebar and the phone menu: one button that opens what can be started from anywhere (an appointment, a
 * sale, a client, blocked time), each only for those allowed to. With a single choice it is that choice's button, no menu.
 */
export function NewMenu({ items }: { items: NewItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const button = "flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700";
  const [only] = items;
  if (items.length === 1 && only) return <Link href={only.href} className={button}><Plus className="h-4 w-4" /> {only.label}</Link>;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={button}>
        <Plus className="h-4 w-4" /> New <ChevronDown className="ml-auto h-4 w-4 opacity-80" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
          {items.map((n) => {
            const I = ICONS[n.icon];
            return (
              <Link key={n.href} href={n.href} role="menuitem" onClick={() => setOpen(false)} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-stone-100">
                <I className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-stone-800">{n.label}</span>
                  <span className="block text-xs text-stone-500">{n.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
