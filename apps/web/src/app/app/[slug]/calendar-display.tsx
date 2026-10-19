"use client";
import { useEffect, useRef, useState } from "react";
import { Printer, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColorMode = "provider" | "category";
export type Density = "compact" | "normal" | "roomy";
export type CalendarDisplay = { color: ColorMode; density: Density };

const KEY = "cal_display";
const EVENT = "calendar:display";
const DEFAULT: CalendarDisplay = { color: "provider", density: "normal" };
/** Pixels per minute of the hour grid at each density. */
export const DENSITY_PX: Record<Density, number> = { compact: 0.8, normal: 1.2, roomy: 1.8 };

function read(): CalendarDisplay {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<CalendarDisplay>;
    return { color: v.color === "category" ? "category" : "provider", density: v.density === "compact" || v.density === "roomy" ? v.density : "normal" };
  } catch {
    return DEFAULT;
  }
}

/**
 * How the calendar is drawn, chosen by the person and kept in this browser: colour by provider (the default: columns and legend are
 * people) or by service category (what kind of work the day holds), and how tall an hour is. Read by the grid; set by the Display menu.
 */
export function useCalendarDisplay(): CalendarDisplay {
  // The server renders the default; the saved choice applies after hydration so markup matches on first paint.
  const [d, setD] = useState<CalendarDisplay>(DEFAULT);
  useEffect(() => {
    setD(read());
    const on = () => setD(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return d;
}

function save(next: CalendarDisplay) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT));
}

/** A quiet sliders button in the calendar header that opens the two choices. */
export function DisplayMenu({ categories }: { /** Whether the business has service categories to colour by. */ categories: boolean }) {
  const d = useCalendarDisplay();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const seg = (label: string, options: { value: string; label: string }[], value: string, pick: (v: string) => void) => (
    <div>
      <p className="mb-1 text-xs font-medium text-stone-600">{label}</p>
      <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => pick(o.value)} aria-pressed={value === o.value} className={cn("flex-1 rounded-md px-2.5 py-1", value === o.value ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100")}>{o.label}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div ref={box} className="relative hidden md:block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Display" title="Display: color and density" aria-haspopup="dialog" aria-expanded={open} className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700", (d.color !== "provider" || d.density !== "normal") && "text-stone-700")}>
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Display" className="absolute right-0 top-full z-30 mt-1 w-72 space-y-3 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
          {categories ? seg("Color by", [{ value: "provider", label: "Provider" }, { value: "category", label: "Service category" }], d.color, (v) => save({ ...d, color: v as ColorMode })) : null}
          {seg("Hour height", [{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "roomy", label: "Roomy" }], d.density, (v) => save({ ...d, density: v as Density }))}
          <p className="text-xs text-stone-500">Remembered in this browser.</p>
          <button type="button" onClick={() => { setOpen(false); setTimeout(() => window.print(), 50); }} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white text-sm font-medium text-stone-800 hover:bg-stone-50">
            <Printer className="h-4 w-4 text-stone-500" /> Print this view
          </button>
        </div>
      ) : null}
    </div>
  );
}
