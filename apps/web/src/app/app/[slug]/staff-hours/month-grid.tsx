import Link from "next/link";
import type { Coverage } from "@/server/coverage";
import { hoursShort, monthLeadingBlanks } from "@/lib/staff-hours";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The month as a roster: a cell per day listing each person in view with their hours that day ("9–5", "Off",
 * "Custom 10–2", "Time off"), from the same resolved schedule as the week grid, so rotations, time off and custom
 * hours are already applied. Closed days are hatched like the week grid's closed areas. Below `md` the days stack,
 * each with its date as a row header, so it reads on a phone.
 */
export function MonthGrid({ coverage, month, people, today, hoursHref, weekHref, hideOff = false }: {
  coverage: Coverage;
  /** "2026-10" */
  month: string;
  people: { id: string; name: string; color: string }[];
  today: string;
  hoursHref: (staffId: string) => string | null;
  /** The week view for the week this date falls in. */
  weekHref: (date: string) => string;
  /** "Only working": leave out the people who are off that day, and say so when that is everyone. */
  hideOff?: boolean;
}) {
  const blanks = monthLeadingBlanks(month);
  const long = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  return (
    <div>
      <div className="hidden grid-cols-7 border-b border-stone-200 text-center text-xs font-semibold uppercase tracking-wide text-stone-500 md:grid">
        {DAY_SHORT.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="md:grid md:grid-cols-7">
        {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} className="hidden border-b border-r border-stone-100 bg-stone-50/50 md:block" />)}
        {coverage.days.map((day) => {
          const closed = !day.open;
          const isToday = day.date === today;
          return (
            <section key={day.date} className={cn("border-b border-stone-100 p-2 md:min-h-[7.5rem] md:border-r", closed ? "hatched" : isToday ? "bg-brand-50/40" : "bg-white")} aria-label={long(day.date)}>
              {/* On a phone the date is the row header and a full-height tap target; on a desktop it is the day number. */}
              <h4 className="mb-1 flex items-center justify-between gap-2 text-sm md:text-xs">
                <Link href={weekHref(day.date)} className={cn("inline-flex min-h-11 min-w-6 items-center justify-center rounded-full px-1.5 font-medium hover:bg-stone-100 md:min-h-0 md:h-6", isToday && "bg-brand-600 text-white hover:bg-brand-600")} title="Open this week">
                  <span className="md:hidden">{long(day.date)}</span>
                  <span className="hidden md:inline">{Number(day.date.slice(8))}</span>
                </Link>
                {closed ? <span className="text-stone-500">Closed</span> : null}
              </h4>
              {closed ? null : hideOff && !people.some((p) => day.lanes.some((l) => l.staffId === p.id)) ? (
                <p className="py-1.5 text-xs text-stone-400 md:py-0 md:text-[11px]">Nobody in</p>
              ) : (
                <ul className="text-xs md:space-y-0.5 md:text-[11px] md:leading-4">
                  {people.map((p) => {
                    const lane = day.lanes.find((l) => l.staffId === p.id);
                    if (hideOff && !lane) return null;
                    const override = day.overrides.find((o) => o.staffId === p.id)?.kind;
                    const text = lane ? `${override === "custom" ? "Custom " : ""}${hoursShort(lane.blocks)}` : override === "off" ? "Time off" : "Off";
                    const href = hoursHref(p.id);
                    const name = <span className={cn("truncate", lane ? "text-stone-800" : "text-stone-500")}>{p.name}</span>;
                    return (
                      <li key={p.id} className={cn("flex items-center gap-1.5 py-1.5 md:py-0", !lane && "text-stone-400")}>
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !lane && "opacity-40")} style={{ background: p.color }} aria-hidden />
                        {href ? <Link href={href} className="min-w-0 truncate hover:underline" title={`${p.name} · change hours`}>{name}</Link> : <span className="min-w-0 truncate">{name}</span>}
                        <span className={cn("ml-auto shrink-0 tabular-nums", lane ? (override === "custom" ? "font-medium text-amber-800" : "text-stone-600") : override === "off" ? "text-amber-700" : "text-stone-400")}>{text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
