import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { RowLink, rowClass } from "@/components/row";
import { formatDateLong } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { CalItem } from "./calendar-grid";

const fmt = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${Math.floor(min / 60) % 24 >= 12 ? "PM" : "AM"}`;

/**
 * Google Calendar's Agenda: the coming days as one list, a heading per day, one row per visit (time, client, service, provider, status),
 * blocks greyed. Reads top to bottom like a day sheet, works on a phone, and is the view to print for a provider's day. Rows open the
 * appointment.
 */
export function AgendaList({ days, items, staff, today }: { days: string[]; items: CalItem[]; staff: { id: string; displayName: string; color: string }[]; today: string }) {
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) byDay.set(i.columnKey, [...(byDay.get(i.columnKey) ?? []), i]);
  const staffName = (id: string) => staff.find((s) => s.id === id)?.displayName ?? "";
  const anything = days.some((d) => (byDay.get(d) ?? []).length);
  return (
    <div className="space-y-4">
      {!anything ? <p className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">Nothing booked on these days.</p> : null}
      {days.map((d) => {
        const list = (byDay.get(d) ?? []).sort((a, b) => a.startMin - b.startMin);
        const seen = new Set<string>();
        const rows = list.filter((x) => (seen.has(x.groupKey) ? false : (seen.add(x.groupKey), true)));
        if (!rows.length) return null;
        return (
          <section key={d} aria-label={formatDateLong(d)}>
            <h2 className={cn("mb-1.5 flex items-center gap-2 text-sm font-semibold", d === today ? "text-brand-700" : "text-stone-700")}>
              {formatDateLong(d)}
              {d === today ? <span className="rounded bg-brand-100 px-1 text-[10px] font-semibold uppercase text-brand-700">Today</span> : null}
              <span className="font-normal text-stone-400">· {rows.length}</span>
            </h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {rows.map((r) => {
                const block = r.status === "block";
                const greyed = block || r.status === "cancelled" || r.status === "no_show";
                return (
                  <li key={r.groupKey} className={cn(rowClass, "flex items-center gap-3 px-3 py-2 text-sm")}>
                    <span className="w-[4.5rem] shrink-0 tabular-nums text-xs leading-tight text-stone-500 sm:w-36">
                      <span className="block sm:inline">{fmt(r.startMin)}</span>
                      <span className="hidden sm:inline"> – </span>
                      <span className="block sm:inline">{fmt(r.endMin)}</span>
                    </span>
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <RowLink href={r.href} className={cn("block truncate font-medium", greyed && "text-stone-500", r.status === "cancelled" || r.status === "no_show" ? "line-through" : "")}>{r.title}</RowLink>
                      <span className="block truncate text-xs text-stone-500">{r.subtitle}{block ? "" : ` · ${staffName(r.staffId)}`}</span>
                    </span>
                    {block ? <span className="shrink-0 text-xs text-stone-500">Blocked</span> : <StatusBadge status={r.status === "class" ? "open" : r.status} className="shrink-0" />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
