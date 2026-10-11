"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Checkbox, Input, Select } from "@/components/ui";

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

const addHours = (t: string, h: number) => {
  const [hh, mm] = t.split(":").map(Number);
  const total = Math.min(23 * 60 + 30, (hh ?? 0) * 60 + (mm ?? 0) + h * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Per-weekday hours with any number of blocks per day (lunch break, split shift). Posts plain fields
 * so the server action can read them without JSON: on_{wd}, loc_{wd}, start_{wd}_{i}, end_{wd}_{i}.
 */
export function WeeklyHoursEditor({ initial, locations }: { initial: DayHours[]; locations: { id: string; name: string }[] }) {
  const [days, setDays] = useState(initial);
  const multi = locations.length > 1;
  const update = (weekday: number, fn: (d: DayHours) => DayHours) => setDays((ds) => ds.map((d) => (d.weekday === weekday ? fn(d) : d)));
  const toggle = (weekday: number, on: boolean) => update(weekday, (d) => ({ ...d, blocks: on ? (d.blocks.length ? d.blocks : [{ start: "09:00", end: "17:00" }]) : [] }));
  const addBreak = (weekday: number) =>
    update(weekday, (d) => {
      const last = d.blocks[d.blocks.length - 1];
      if (!last) return d;
      // One block that spans lunch: split it. Otherwise add a block after the last one.
      if (d.blocks.length === 1 && last.start < "12:00" && last.end > "13:00") return { ...d, blocks: [{ start: last.start, end: "12:00" }, { start: "13:00", end: last.end }] };
      return { ...d, blocks: [...d.blocks, { start: addHours(last.end, 1), end: addHours(last.end, 4) }] };
    });
  const remove = (weekday: number, i: number) => update(weekday, (d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }));
  const setBlock = (weekday: number, i: number, patch: Partial<Block>) => update(weekday, (d) => ({ ...d, blocks: d.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  // Phones: the day (and the location) take a row of their own above the times. Wider: one row per block.
  const grid = multi
    ? "grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)_2rem] sm:grid-cols-[8.5rem_9.5rem_max-content_9.5rem_2rem_minmax(14rem,22rem)]"
    : "grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)_2rem] sm:grid-cols-[8.5rem_9.5rem_max-content_9.5rem_2rem]";
  const span = "col-span-4 sm:col-span-1";
  const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-800";

  return (
    <div className="space-y-1">
      {days.map((d) => {
        const on = d.blocks.length > 0;
        const rows = on ? d.blocks : [{ start: "09:00", end: "17:00" }];
        return (
          <div key={d.weekday} className="py-1 sm:py-0.5">
            {rows.map((b, i) => (
              <div key={i} className={`grid items-center gap-3 py-0.5 text-sm ${grid}`}>
                {i === 0 ? (
                  <Checkbox name={`on_${d.weekday}`} checked={on} onChange={(e) => toggle(d.weekday, e.target.checked)} label={d.name} className={`${span} !items-center [&>input]:mt-0`} />
                ) : (
                  <span className={`${span} pl-7 text-xs text-stone-500`}>and</span>
                )}
                <Input name={on ? `start_${d.weekday}_${i}` : undefined} type="time" value={b.start} disabled={!on} onChange={(e) => setBlock(d.weekday, i, { start: e.target.value })} className="w-full min-w-0 disabled:opacity-50" aria-label={`${d.name} start${i ? ` (block ${i + 1})` : ""}`} />
                <span className="text-stone-400">to</span>
                <Input name={on ? `end_${d.weekday}_${i}` : undefined} type="time" value={b.end} disabled={!on} onChange={(e) => setBlock(d.weekday, i, { end: e.target.value })} className="w-full min-w-0 disabled:opacity-50" aria-label={`${d.name} end${i ? ` (block ${i + 1})` : ""}`} />
                {!on ? (
                  <span />
                ) : i === 0 ? (
                  <button type="button" className={iconBtn} onClick={() => addBreak(d.weekday)} aria-label={`${d.name}: add a break or second block`} title="Add a break or second block">
                    <Plus className="h-4 w-4" />
                  </button>
                ) : (
                  <button type="button" className={iconBtn} onClick={() => remove(d.weekday, i)} aria-label={`${d.name}: remove block ${i + 1}`} title="Remove this block">
                    <X className="h-4 w-4" />
                  </button>
                )}
                {multi ? (
                  i === 0 ? (
                    <Select name={`loc_${d.weekday}`} value={d.locationId} disabled={!on} onChange={(e) => update(d.weekday, (x) => ({ ...x, locationId: e.target.value }))} aria-label={`${d.name} location`} className={`${span} disabled:opacity-50`}>
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
  );
}
