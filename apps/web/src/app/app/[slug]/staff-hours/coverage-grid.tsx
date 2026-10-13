import Link from "next/link";
import type { Coverage, CoverageDay, CoverageStrip } from "@/server/coverage";
import { time12 } from "@/lib/hours";
import { cn } from "@/lib/utils";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PX_PER_HOUR = 44;
const fmt = (min: number) => (min >= 24 * 60 ? "12am" : time12(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`));
/** Service names when only a few are missing, otherwise the categories they fall in. */
const describeMissing = (s: CoverageStrip) => (s.missingCount <= 3 ? s.missing.join(", ") : s.missingGroups.join(", "));
const STRIP: Record<CoverageStrip["state"], string> = { closed: "hatched", none: "bg-red-400", partial: "bg-amber-400", full: "bg-emerald-400" };
/** Coverage view: the whole stretch is tinted instead of showing people. */
const BAND: Record<CoverageStrip["state"], string> = { closed: "", none: "bg-red-100 text-red-800", partial: "bg-amber-100 text-amber-900", full: "bg-emerald-100 text-emerald-800" };
export type CoverageMode = "coverage" | "people";

/**
 * Time down the side, the week across the top. Each day column shows opening hours as the white
 * area (closed time is hatched, as on the calendar), every provider on duty as a coloured lane, and a strip on the left edge that says whether
 * the services in scope are covered (green), partly covered (amber) or nobody is in (red).
 * In "coverage" mode the people are left out and each stretch of the day is tinted by that state, with the
 * uncovered categories written on it: the simple answer to "is every category covered when we are open?".
 */
export function CoverageGrid({ coverage, today, hoursHref, mode = "people" }: { coverage: Coverage; today: string; hoursHref: (staffId: string) => string | null; mode?: CoverageMode }) {
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
              <p className="text-stone-500">{d.open ? `${fmt(d.open.start)}–${fmt(d.open.end)}` : "Closed"}{mode === "people" && d.lanes.length ? ` · ${d.lanes.length} in` : ""}</p>
            </div>
          ))}
        </div>
        {/* Body */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height }}>
          <div className="relative text-[11px] text-stone-500">
            {hours.map((t) => <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: y(t) }}>{fmt(t)}</span>)}
          </div>
          {days.map((d) => <DayColumn key={d.date} day={d} y={y} hours={hours} height={height} isToday={d.date === today} hoursHref={hoursHref} mode={mode} />)}
        </div>
      </div>
    </div>
  );
}

function DayColumn({ day, y, hours, height, isToday, hoursHref, mode }: { day: CoverageDay; y: (m: number) => number; hours: number[]; height: number; isToday: boolean; hoursHref: (staffId: string) => string | null; mode: CoverageMode }) {
  const laneW = day.lanes.length ? 100 / day.lanes.length : 100;
  // Two or more lanes leave no room for a name across; write it down the lane instead.
  const narrow = day.lanes.length >= 2;
  return (
    <div className={cn("hatched relative border-l border-stone-100")} style={{ height }}>
      {/* Opening hours: the white area */}
      {/* Opaque, so the hatching never shows through open hours (today is tinted, not translucent). */}
      {day.open ? <div className={cn("absolute inset-x-0", isToday ? "bg-brand-50" : "bg-white")} style={{ top: y(day.open.start), height: y(day.open.end) - y(day.open.start) }} /> : null}
      {/* Open with nobody in: the whole stretch blushes, not just the strip. */}
      {day.uncovered.map((u, i) => <div key={`u${i}`} className="pointer-events-none absolute inset-x-0 bg-red-50" style={{ top: y(u.start), height: y(u.end) - y(u.start) }} />)}
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
      {/* Coverage view: tint each stretch and say what is missing */}
      {mode === "coverage"
        ? day.strip.filter((s) => s.state !== "closed").map((s, i) => {
            const px = y(s.end) - y(s.start);
            const label = s.state === "none" ? "Nobody in" : s.state === "partial" ? `No one for ${describeMissing(s)}` : px >= 40 ? "All covered" : "";
            return (
              <div key={`b${i}`} className={cn("absolute inset-x-2 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] leading-tight ring-1 ring-white/70", BAND[s.state])} style={{ top: y(s.start) + 1, height: Math.max(3, px - 2) }} title={`${fmt(s.start)}–${fmt(s.end)}: ${s.state === "none" ? "nobody in" : s.state === "full" ? "all covered" : `not covered: ${describeMissing(s)}`}`}>
                {px >= 22 ? (
                  <span className={cn("block", s.state === "full" && "font-medium opacity-80")} style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.min(6, Math.max(2, Math.floor((px - 10) / 14))), overflow: "hidden" }}>
                    {label}
                    {px >= 54 ? <span className="mt-0.5 block text-[10px] font-normal opacity-80">{fmt(s.start)}–{fmt(s.end)}</span> : null}
                  </span>
                ) : null}
              </div>
            );
          })
        : null}
      {/* Provider lanes */}
      {mode === "people" && day.lanes.map((l, i) =>
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
      {mode === "people" && day.open && day.lanes.length === 0 ? <p className="absolute inset-x-0 px-2 text-center text-[11px] text-red-600" style={{ top: y(day.open.start) + 6 }}>Open, nobody in</p> : null}
    </div>
  );
}

/** Under the grid: the stretches that need attention, in words, day by day. */
export function CoverageGaps({ coverage }: { coverage: Coverage }) {
  const md = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const days = coverage.days
    .map((d) => ({
      date: d.date,
      lines: d.strip
        .filter((s) => s.state !== "full" && s.state !== "closed")
        .map((s) => ({ tone: s.state === "none" ? ("red" as const) : ("amber" as const), text: s.state === "none" ? `${fmt(s.start)}–${fmt(s.end)}: open with nobody in` : `${fmt(s.start)}–${fmt(s.end)}: no one for ${describeMissing(s)}` })),
    }))
    .filter((d) => d.lines.length);
  if (!days.length) return <p className="px-4 py-3 text-sm text-emerald-700">Every opening hour this week has someone in who can do {coverage.scope.label === "All services" ? "every service" : coverage.scope.label.toLowerCase()}.</p>;
  return (
    <div className="divide-y divide-stone-100">
      {days.map((d) => (
        <section key={d.date} className="px-4 py-3">
          <h4 className="mb-1 text-sm font-semibold text-stone-800">{md(d.date)}</h4>
          <ul className="space-y-1 text-sm">
            {d.lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.tone === "red" ? "bg-red-400" : "bg-amber-400")} />
                <span className="text-stone-700">{l.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
