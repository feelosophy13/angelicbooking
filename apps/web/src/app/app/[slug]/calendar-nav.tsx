"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget, miniMonthCells, monthLabel, monthStartOf, SHORTCUTS, shiftMonth, shortcutFor, weekdayLabels, type CalendarShortcut } from "@/lib/calendar-nav";

/** Fired on `window` to open the date picker from a shortcut (g). */
const PICK_EVENT = "calendar:pick-date";
/** Fired on `window` to open the ⌘K search from a shortcut (/); the palette listens. */
export const SEARCH_EVENT = "app:search";

/**
 * "Pick a date": a small button beside the arrows that opens a mini month. Clicking a day goes to it in the current view, with
 * the other filters kept (`hrefTemplate` has `{date}` where the day goes). Closes on a pick, Escape or a click outside.
 */
export function DateJump({ date, today, hrefTemplate, weekStart = 1 }: { date: string; today: string; hrefTemplate: string; /** 0 = Sunday … 6 = Saturday. */ weekStart?: number }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStartOf(date));
  // On a phone the button can sit anywhere in a wrapped header, so the popover slides left or right to stay on screen (px from the button's left edge).
  const [offset, setOffset] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => { setOpen(false); setMonth(monthStartOf(date)); }, [path, date]);
  useEffect(() => {
    const onPick = () => setOpen((o) => !o);
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const href = (d: string) => hrefTemplate.replace("{date}", d);
  const cells = miniMonthCells(month, weekStart);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={(e) => {
          const left = e.currentTarget.getBoundingClientRect().left;
          setOffset(Math.min(0, window.innerWidth - 8 - 288 - left) + Math.max(0, 8 - left));
          setOpen((o) => !o);
        }}
        aria-label="Pick a date"
        title="Pick a date (g)"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      {open ? (
        <div role="dialog" aria-label="Pick a date" className="absolute top-full z-30 mt-1 w-72 rounded-xl border border-stone-200 bg-white p-3 shadow-lg" style={{ left: offset }}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month" className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100"><ChevronLeft className="h-4 w-4" /></button>
            <p className="text-sm font-semibold text-stone-900">{monthLabel(month)}</p>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month" className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">
            {weekdayLabels(weekStart).map((d) => <div key={d} className="py-1">{d.slice(0, 2)}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((c) => (
              <Link
                key={c.date}
                href={href(c.date)}
                aria-label={c.date}
                aria-current={c.date === date ? "date" : undefined}
                className={cn(
                  "mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm hover:bg-stone-100",
                  c.outside && "text-stone-400",
                  c.date === today && c.date !== date && "font-semibold text-brand-700 ring-1 ring-inset ring-brand-300",
                  c.date === date && "bg-brand-600 font-semibold text-white hover:bg-brand-600",
                )}
              >
                {c.day}
              </Link>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 text-xs">
            <Link href={href(today)} className="font-medium text-brand-700 underline">Today</Link>
            {month !== monthStartOf(today) ? <button type="button" onClick={() => setMonth(monthStartOf(today))} className="text-stone-500 hover:text-stone-800">This month</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Keyboard shortcuts on the calendar page (Google Calendar's keys): t today, ← → (or j k, p n) to move, g pick a date, d w m for the
 * views, c for a new appointment, / for search, ? for this list. Nothing fires while typing in a field or with a modifier held.
 * Renders a small "?" button in the corner of the page that opens the same list.
 */
export function CalendarShortcuts({ hrefs }: { hrefs: { today: string; prev: string; next: string; day: string; week: string; month: string; agenda: string; create: string | null } }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, inField: isTypingTarget(document.activeElement) });
      if (!action) return;
      // Something else is open (a dialog, the search palette): leave the keys to it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const go = (href: string | null) => { if (href) { e.preventDefault(); router.push(href); } };
      const map: Record<CalendarShortcut, () => void> = {
        today: () => go(hrefs.today),
        prev: () => go(hrefs.prev),
        next: () => go(hrefs.next),
        day: () => go(hrefs.day),
        week: () => go(hrefs.week),
        month: () => go(hrefs.month),
        agenda: () => go(hrefs.agenda),
        create: () => go(hrefs.create),
        pick: () => { e.preventDefault(); window.dispatchEvent(new Event(PICK_EVENT)); },
        search: () => { e.preventDefault(); window.dispatchEvent(new Event(SEARCH_EVENT)); },
        help: () => { e.preventDefault(); setHelp((h) => !h); },
      };
      map[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, router]);
  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHelp(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [help]);
  return (
    <>
      <button type="button" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="hidden h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 md:inline-flex">
        <Keyboard className="h-4 w-4" />
      </button>
      {help ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4" onClick={() => setHelp(false)}>
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-stone-900">Keyboard shortcuts</h2>
            <p className="mt-0.5 text-xs text-stone-500">On the calendar, when you are not typing in a box.</p>
            <ul className="mt-3 divide-y divide-stone-100 text-sm">
              {SHORTCUTS.filter((s) => s.action !== "create" || hrefs.create).map((s) => (
                <li key={s.action} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-stone-700">{s.label}</span>
                  <span className="flex gap-1">{s.keys.map((k) => <kbd key={k} className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-sans text-xs text-stone-700">{k}</kbd>)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">Escape closes this and any open popover.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
