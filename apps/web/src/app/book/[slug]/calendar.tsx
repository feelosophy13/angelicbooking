import Link from "next/link";
import { shiftISODate, formatDateLong, cn } from "@/lib/utils";

/**
 * Month grid for picking a day, shared by booking and rescheduling. Days with openings are highlighted;
 * a full day is still a link when `fullDayHint` is set (booking offers a waitlist there).
 */
export function MonthCalendar(props: {
  /** First of the month shown, YYYY-MM-01. */
  monthStart: string;
  today: string;
  maxDate: string;
  available: Set<string>;
  selected: string | null;
  isClosed?: (d: string) => boolean;
  dayHref: (d: string) => string;
  monthHref: (ym: string) => string;
  fullDayHint?: boolean;
}) {
  const { monthStart, today, maxDate, available, selected } = props;
  const daysInMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
  const firstDow = new Date(monthStart + "T00:00:00Z").getUTCDay();
  const prevMonth = shiftISODate(monthStart, -1).slice(0, 7);
  const nextMonth = shiftISODate(monthStart, daysInMonth).slice(0, 7);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(monthStart + "T00:00:00Z"));
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <Link href={props.monthHref(prevMonth)} scroll={false} aria-label="Previous month" className={cn("flex h-8 w-8 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100", prevMonth < today.slice(0, 7) && "pointer-events-none opacity-30")}>‹</Link>
        <p className="font-semibold text-stone-900">{monthLabel}</p>
        <Link href={props.monthHref(nextMonth)} scroll={false} aria-label="Next month" className={cn("flex h-8 w-8 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100", `${nextMonth}-01` > maxDate && "pointer-events-none opacity-30")}>›</Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-stone-400">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = shiftISODate(monthStart, i);
          const bookable = d >= today && d <= maxDate && !props.isClosed?.(d);
          const label = formatDateLong(d);
          if (available.has(d) && bookable) {
            return (
              <Link key={d} href={props.dayHref(d)} aria-label={`${label}: openings available`} aria-current={d === selected ? "date" : undefined} className={cn("rounded-xl py-2 text-center text-sm font-semibold transition", d === selected ? "text-white shadow" : "hover:brightness-95")} style={d === selected ? { background: "var(--brand)" } : { background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{i + 1}</Link>
            );
          }
          if (bookable && props.fullDayHint) {
            return (
              <Link key={d} href={props.dayHref(d)} aria-label={`${label}: no openings, join the waitlist`} aria-current={d === selected ? "date" : undefined} className={cn("rounded-xl border border-dashed py-2 text-center text-sm", d === selected ? "border-stone-500 text-stone-800" : "border-stone-200 text-stone-400 hover:border-stone-400")}>{i + 1}</Link>
            );
          }
          return <div key={d} aria-hidden className="py-2 text-center text-sm text-stone-300">{i + 1}</div>;
        })}
      </div>
      <p className="mt-3 text-[11px] text-stone-500">{props.fullDayHint ? "Highlighted days have openings. Tap a full day to join its waitlist." : "Highlighted days have openings."}</p>
    </div>
  );
}
