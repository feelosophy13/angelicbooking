import Link from "next/link";
import type { Coverage, CoverageDay, CoverageStrip } from "@/server/coverage";
import { time12 } from "@/lib/hours";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PX_PER_HOUR = 44;
const fmt = (min: number) => (min >= 24 * 60 ? "12am" : time12(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`));
/** A few names when the list is short, otherwise categories with counts. */
const describeMissing = (s: CoverageStrip) => (s.missingCount <= 3 ? s.missing.join(", ") : s.missingGroups.slice(0, 4).join(", ") + (s.missingGroups.length > 4 ? "…" : ""));
const STRIP: Record<CoverageStrip["state"], string> = { closed: "bg-stone-200", none: "bg-red-400", partial: "bg-amber-400", full: "bg-emerald-400" };

/**
 * Time down the side, the week across the top. Each day column shows opening hours as the white
 * area, every provider on duty as a coloured lane, and a strip on the left edge that says whether
 * the services in scope are covered (green), partly covered (amber) or nobody is in (red).
 */
export function CoverageGrid({ coverage, today, hoursHref }: { coverage: Coverage; today: string; hoursHref: (staffId: string) => string | null }) {
  const { startMin, endMin, days } = coverage;
  const height = ((endMin - startMin) / 60) * PX_PER_HOUR;
  const y = (min: number) => ((Math.min(Math.max(min, startMin), endMin) - startMin) / 60) * PX_PER_HOUR;
  const hours: number[] = [];
  for (let t = startMin; t < endMin; t += 60) hours.push(t);
  const md = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[56rem]">
        {/* Header: day, date, opening hours */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-stone-200 text-xs">
          <div />
          {days.map((d) => (
            <div key={d.date} className={cn("border-l border-stone-100 px-2 py-2", d.date === today && "bg-brand-50/60")}>
              <p className="font-semibold text-stone-800">{DAY_SHORT[d.weekday]} <span className="font-normal text-stone-500">{md(d.date)}</span></p>
              <p className="text-stone-500">{d.open ? `${fmt(d.open.start)}–${fmt(d.open.end)}` : "Closed"}{d.lanes.length ? ` · ${d.lanes.length} in` : ""}</p>
            </div>
          ))}
        </div>
        {/* Body */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height }}>
          <div className="relative text-[11px] text-stone-500">
            {hours.map((t) => <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: y(t) }}>{fmt(t)}</span>)}
          </div>
          {days.map((d) => <DayColumn key={d.date} day={d} y={y} hours={hours} height={height} isToday={d.date === today} hoursHref={hoursHref} />)}
        </div>
      </div>
    </div>
  );
}

function DayColumn({ day, y, hours, height, isToday, hoursHref }: { day: CoverageDay; y: (m: number) => number; hours: number[]; height: number; isToday: boolean; hoursHref: (staffId: string) => string | null }) {
  const laneW = day.lanes.length ? 100 / day.lanes.length : 100;
  // Two or more lanes leave no room for a name across; write it down the lane instead.
  const narrow = day.lanes.length >= 2;
  return (
    <div className={cn("relative border-l border-stone-100 bg-stone-100/70", isToday && "bg-brand-50/40")} style={{ height }}>
      {/* Opening hours: the white area */}
      {day.open ? <div className="absolute inset-x-0 bg-white" style={{ top: y(day.open.start), height: y(day.open.end) - y(day.open.start) }} /> : null}
      {/* Hour lines */}
      {hours.map((t) => <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-stone-100" style={{ top: y(t) }} />)}
      {/* Coverage strip on the left edge */}
      {day.strip.map((s, i) => (
        <div
          key={i}
          className={cn("absolute left-0 w-1.5", STRIP[s.state])}
          style={{ top: y(s.start), height: Math.max(2, y(s.end) - y(s.start)) }}
          title={`${fmt(s.start)}–${fmt(s.end)}: ${s.state === "none" ? "nobody in" : s.state === "full" ? "all covered" : `not covered: ${describeMissing(s)}`}`}
        />
      ))}
      {/* Provider lanes */}
      {day.lanes.map((l, i) =>
        l.blocks.map((b, j) => {
          const href = hoursHref(l.staffId);
          const body = narrow ? (
            <span className="block whitespace-nowrap font-semibold" style={{ writingMode: "vertical-rl" }}>{l.name} <span className="font-normal opacity-90">{fmt(b.start)}–{fmt(b.end)}</span></span>
          ) : (
            <>
              <span className="block truncate font-semibold">{l.name}</span>
              <span className="block truncate text-[10px] opacity-90">{fmt(b.start)}–{fmt(b.end)}</span>
            </>
          );
          const cls = cn("absolute overflow-hidden rounded-md text-[11px] leading-tight text-white shadow-sm ring-1 ring-white/60", narrow ? "px-0.5 py-1.5" : "px-1.5 py-1");
          const style = { top: y(b.start) + 1, height: Math.max(18, y(b.end) - y(b.start) - 2), left: `calc(0.5rem + ${i * laneW}% - ${i * laneW * 0.01}rem)`, width: `calc(${laneW}% - 0.6rem)`, background: l.color };
          return href ? (
            <Link key={`${l.staffId}:${j}`} href={href} className={cn(cls, "hover:brightness-95")} style={style} title={`${l.name} · ${fmt(b.start)}–${fmt(b.end)} · change hours`}>{body}</Link>
          ) : (
            <div key={`${l.staffId}:${j}`} className={cls} style={style} title={`${l.name} · ${fmt(b.start)}–${fmt(b.end)}`}>{body}</div>
          );
        }),
      )}
      {day.open && day.lanes.length === 0 ? <p className="absolute inset-x-0 px-2 text-center text-[11px] text-red-600" style={{ top: y(day.open.start) + 6 }}>Open, nobody in</p> : null}
    </div>
  );
}

/** Under the grid: the stretches that need attention, in words. */
export function CoverageGaps({ coverage }: { coverage: Coverage }) {
  const lines: { date: string; weekday: number; text: string; tone: "red" | "amber" }[] = [];
  for (const d of coverage.days) {
    for (const s of d.strip) {
      if (s.state === "none") lines.push({ date: d.date, weekday: d.weekday, text: `${fmt(s.start)}–${fmt(s.end)}: open with nobody in`, tone: "red" });
      else if (s.state === "partial") lines.push({ date: d.date, weekday: d.weekday, text: `${fmt(s.start)}–${fmt(s.end)}: no one for ${describeMissing(s)}`, tone: "amber" });
    }
  }
  if (!lines.length) return <p className="px-4 py-3 text-sm text-emerald-700">Every opening hour this week has someone in who can do {coverage.scope.label === "All services" ? "every service" : coverage.scope.label.toLowerCase()}.</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-2">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.tone === "red" ? "bg-red-400" : "bg-amber-400")} />
          <span className="w-10 shrink-0 font-medium text-stone-800">{DAY_SHORT[l.weekday]}</span>
          <span className="text-stone-700">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}
