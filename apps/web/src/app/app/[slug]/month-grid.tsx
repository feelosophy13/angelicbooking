import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CalItem } from "./calendar-grid";

const shift = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

/** Month overview: a cell per day with up to three appointments and a count. */
export function MonthGrid({ monthStart, daysInMonth, today, items, staff, slug, staffFilter }: { monthStart: string; daysInMonth: number; today: string; items: CalItem[]; staff: { id: string; displayName: string; color: string }[]; slug: string; staffFilter: string | null }) {
  const firstDow = (new Date(monthStart + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday-first
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) byDay.set(i.columnKey, [...(byDay.get(i.columnKey) ?? []), i]);
  const fmt = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")}`;
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="grid grid-cols-7 border-b border-stone-200 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} className="min-h-28 border-b border-r border-stone-100 bg-stone-50/50" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = shift(monthStart, i);
          const list = (byDay.get(d) ?? []).sort((a, b) => a.startMin - b.startMin);
          const seen = new Set<string>();
          const cards = list.filter((x) => (seen.has(x.groupKey) ? false : (seen.add(x.groupKey), true)));
          return (
            <div key={d} className={cn("min-h-28 border-b border-r border-stone-100 p-1.5", d === today && "bg-brand-50/40")}>
              <Link href={`?view=day&date=${d}${staffFilter ? `&staff=${staffFilter}` : ""}`} className={cn("mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium hover:bg-stone-100", d === today && "bg-brand-600 text-white hover:bg-brand-600")}>{i + 1}</Link>
              <ul className="space-y-0.5">
                {cards.slice(0, 3).map((c) => (
                  <li key={c.groupKey}>
                    <Link href={c.href} className="flex items-center gap-1 truncate rounded px-1 text-[11px] hover:bg-stone-100" title={`${c.title} · ${c.subtitle}`}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: staff.find((s) => s.id === c.staffId)?.color ?? c.color }} />
                      <span className="text-stone-500">{fmt(c.startMin)}</span>
                      <span className="truncate">{c.title}</span>
                    </Link>
                  </li>
                ))}
                {cards.length > 3 ? <li><Link href={`?view=day&date=${d}`} className="px-1 text-[11px] text-brand-700">+{cards.length - 3} more</Link></li> : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
