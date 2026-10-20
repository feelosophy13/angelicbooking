"use client";
import { Checkbox } from "@/components/ui";
import { useState } from "react";
import type { WeeklyHours } from "@angelic/core";
import { WEEKDAYS } from "@/lib/hours";

/** Seven rows of open/close with a Closed tick box; posts h{wd}_open / h{wd}_close / h{wd}_closed. */
export function HoursEditor({ initial }: { initial: WeeklyHours | null }) {
  const [closed, setClosed] = useState<boolean[]>(Array.from({ length: 7 }, (_, d) => (initial ? initial[String(d)] === null : d === 0)));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
      {order.map((d) => {
        const h = initial?.[String(d)] ?? null;
        return (
          // On a phone each day is two lines (the day and Closed, then the two times); from sm up it is one row.
          <div key={d} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-3 py-2 text-sm sm:grid-cols-[6rem_1fr_auto_1fr_6rem] sm:py-1.5">
            <span className="font-medium">{WEEKDAYS[d]}</span>
            <div className="order-2 col-span-2 flex items-center gap-2 sm:order-none sm:contents">
              <input type="time" name={`h${d}_open`} defaultValue={h?.open ?? "10:00"} disabled={closed[d]} className="h-10 min-w-0 flex-1 rounded border border-stone-300 px-2 text-sm disabled:opacity-40 sm:h-8" />
              <span className="text-stone-400">to</span>
              <input type="time" name={`h${d}_close`} defaultValue={h?.close ?? "18:00"} disabled={closed[d]} className="h-10 min-w-0 flex-1 rounded border border-stone-300 px-2 text-sm disabled:opacity-40 sm:h-8" />
            </div>
            <Checkbox name={`h${d}_closed`} checked={closed[d]} onChange={(e) => setClosed((c) => c.map((v, i) => (i === d ? e.target.checked : v)))} label="Closed" className="order-1 text-xs !items-center sm:order-none [&>input]:mt-0" />
          </div>
        );
      })}
    </div>
  );
}
