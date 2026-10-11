"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface Block {
  start: string;
  end: string;
}
export interface DayHours {
  weekday: number;
  name: string;
  blocks: Block[];
  locationId: string;
}
/** One week of the rotation: seven days. */
export type WeekHours = DayHours[];

const addHours = (t: string, h: number) => {
  const [hh, mm] = t.split(":").map(Number);
  const total = Math.min(23 * 60 + 30, (hh ?? 0) * 60 + (mm ?? 0) + h * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const emptyWeek = (from: WeekHours): WeekHours => from.map((d) => ({ ...d, blocks: [] }));
const cloneWeek = (from: WeekHours): WeekHours => from.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) }));

/**
 * Per-weekday hours with any number of blocks per day (lunch break, split shift), optionally repeating on a
 * 2–4 week rotation. Posts plain fields so the server action can read them without JSON:
 * rotationWeeks, thisWeekIs, and per week w: on_{w}_{wd}, loc_{w}_{wd}, start_{w}_{wd}_{i}, end_{w}_{wd}_{i}.
 */
export function WeeklyHoursEditor({
  initial,
  locations,
  rotationWeeks: initialWeeks,
  thisWeekIs: initialThisWeek,
  thisWeekLabel,
}: {
  initial: WeekHours[];
  locations: { id: string; name: string }[];
  rotationWeeks: number;
  /** 0-based week of the rotation the current calendar week falls in. */
  thisWeekIs: number;
  /** "Oct 12 – 18" */
  thisWeekLabel: string;
}) {
  const [weeks, setWeeks] = useState<WeekHours[]>(initial);
  const [rotation, setRotation] = useState(initialWeeks);
  const [thisWeekIs, setThisWeekIs] = useState(initialThisWeek);
  const [tab, setTab] = useState(0);
  const multi = locations.length > 1;

  const changeRotation = (n: number) => {
    setRotation(n);
    setWeeks((ws) => {
      const out = ws.slice(0, n);
      while (out.length < n) out.push(emptyWeek(ws[0]!));
      return out;
    });
    setTab((t) => Math.min(t, n - 1));
    setThisWeekIs((w) => Math.min(w, n - 1));
  };
  const update = (w: number, weekday: number, fn: (d: DayHours) => DayHours) =>
    setWeeks((ws) => ws.map((week, i) => (i === w ? week.map((d) => (d.weekday === weekday ? fn(d) : d)) : week)));
  const toggle = (w: number, weekday: number, on: boolean) => update(w, weekday, (d) => ({ ...d, blocks: on ? (d.blocks.length ? d.blocks : [{ start: "09:00", end: "17:00" }]) : [] }));
  const addBreak = (w: number, weekday: number) =>
    update(w, weekday, (d) => {
      const last = d.blocks[d.blocks.length - 1];
      if (!last) return d;
      // One block that spans lunch: split it. Otherwise add a block after the last one.
      if (d.blocks.length === 1 && last.start < "12:00" && last.end > "13:00") return { ...d, blocks: [{ start: last.start, end: "12:00" }, { start: "13:00", end: last.end }] };
      return { ...d, blocks: [...d.blocks, { start: addHours(last.end, 1), end: addHours(last.end, 4) }] };
    });
  const remove = (w: number, weekday: number, i: number) => update(w, weekday, (d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }));
  const setBlock = (w: number, weekday: number, i: number, patch: Partial<Block>) => update(w, weekday, (d) => ({ ...d, blocks: d.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const copyFromFirst = (w: number) => setWeeks((ws) => ws.map((week, i) => (i === w ? cloneWeek(ws[0]!) : week)));

  // Phones: the day (and the location) take a row of their own above the times. Wider: one row per block.
  const grid = multi
    ? "grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)_2rem] sm:grid-cols-[8.5rem_9.5rem_max-content_9.5rem_2rem_minmax(14rem,22rem)]"
    : "grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)_2rem] sm:grid-cols-[8.5rem_9.5rem_max-content_9.5rem_2rem]";
  const span = "col-span-4 sm:col-span-1";
  const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-800";
  const weekLabel = (i: number) => `Week ${i + 1}`;

  return (
    <div className="space-y-3">
      <input type="hidden" name="rotationWeeks" value={rotation} />
      <input type="hidden" name="thisWeekIs" value={rotation > 1 ? thisWeekIs : 0} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-stone-600">Repeats</span>
          <Select value={rotation} onChange={(e) => changeRotation(Number(e.target.value))} aria-label="How often the hours repeat" className="w-auto">
            <option value={1}>every week</option>
            <option value={2}>every 2 weeks</option>
            <option value={3}>every 3 weeks</option>
            <option value={4}>every 4 weeks</option>
          </Select>
        </label>
        {rotation > 1 ? (
          <label className="flex items-center gap-2">
            <span className="text-stone-600">This week ({thisWeekLabel}) is</span>
            <Select value={thisWeekIs} onChange={(e) => setThisWeekIs(Number(e.target.value))} aria-label="Which week of the rotation the current week is" className="w-auto">
              {weeks.map((_, i) => <option key={i} value={i}>{weekLabel(i)}</option>)}
            </Select>
          </label>
        ) : null}
      </div>

      {rotation > 1 ? (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Rotation weeks">
          {weeks.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={cn("rounded-full border px-3 py-1 text-sm", tab === i ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-200 text-stone-600 hover:bg-stone-50")}
            >
              {weekLabel(i)}
              {i === thisWeekIs ? <span className="ml-1 text-xs text-stone-500">· now</span> : null}
            </button>
          ))}
          {tab > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => copyFromFirst(tab)}>Copy Week 1</Button>
          ) : null}
        </div>
      ) : null}

      {weeks.map((week, w) => (
        // Every week stays in the DOM (hidden) so one Save posts the whole rotation.
        <div key={w} className={cn("space-y-1", w !== tab && "hidden")} role={rotation > 1 ? "tabpanel" : undefined} aria-label={rotation > 1 ? weekLabel(w) : undefined}>
          {week.map((d) => {
            const on = d.blocks.length > 0;
            const rows = on ? d.blocks : [{ start: "09:00", end: "17:00" }];
            const label = rotation > 1 ? `${weekLabel(w)} ${d.name}` : d.name;
            return (
              <div key={d.weekday} className="py-1 sm:py-0.5">
                {rows.map((b, i) => (
                  <div key={i} className={`grid items-center gap-3 py-0.5 text-sm ${grid}`}>
                    {i === 0 ? (
                      <Checkbox name={`on_${w}_${d.weekday}`} checked={on} onChange={(e) => toggle(w, d.weekday, e.target.checked)} label={d.name} className={`${span} !items-center [&>input]:mt-0`} />
                    ) : (
                      <span className={`${span} pl-7 text-xs text-stone-500`}>and</span>
                    )}
                    <Input name={on ? `start_${w}_${d.weekday}_${i}` : undefined} type="time" value={b.start} disabled={!on} onChange={(e) => setBlock(w, d.weekday, i, { start: e.target.value })} className="w-full min-w-0 disabled:opacity-50" aria-label={`${label} start${i ? ` (block ${i + 1})` : ""}`} />
                    <span className="text-stone-400">to</span>
                    <Input name={on ? `end_${w}_${d.weekday}_${i}` : undefined} type="time" value={b.end} disabled={!on} onChange={(e) => setBlock(w, d.weekday, i, { end: e.target.value })} className="w-full min-w-0 disabled:opacity-50" aria-label={`${label} end${i ? ` (block ${i + 1})` : ""}`} />
                    {!on ? (
                      <span />
                    ) : i === 0 ? (
                      <button type="button" className={iconBtn} onClick={() => addBreak(w, d.weekday)} aria-label={`${label}: add a break or second block`} title="Add a break or second block">
                        <Plus className="h-4 w-4" />
                      </button>
                    ) : (
                      <button type="button" className={iconBtn} onClick={() => remove(w, d.weekday, i)} aria-label={`${label}: remove block ${i + 1}`} title="Remove this block">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {multi ? (
                      i === 0 ? (
                        <Select name={`loc_${w}_${d.weekday}`} value={d.locationId} disabled={!on} onChange={(e) => update(w, d.weekday, (x) => ({ ...x, locationId: e.target.value }))} aria-label={`${label} location`} className={`${span} disabled:opacity-50`}>
                          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </Select>
                      ) : (
                        <span className="hidden sm:block" />
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
