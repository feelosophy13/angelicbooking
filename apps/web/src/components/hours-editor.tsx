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
          <div key={d} className="grid grid-cols-[6rem_1fr_auto_1fr_6rem] items-center gap-2 px-3 py-1.5 text-sm">
            <span className="font-medium">{WEEKDAYS[d]}</span>
            <input type="time" name={`h${d}_open`} defaultValue={h?.open ?? "10:00"} disabled={closed[d]} className="h-8 rounded border border-stone-300 px-2 text-sm disabled:opacity-40" />
            <span className="text-stone-400">to</span>
            <input type="time" name={`h${d}_close`} defaultValue={h?.close ?? "18:00"} disabled={closed[d]} className="h-8 rounded border border-stone-300 px-2 text-sm disabled:opacity-40" />
            <Checkbox name={`h${d}_closed`} checked={closed[d]} onChange={(e) => setClosed((c) => c.map((v, i) => (i === d ? e.target.checked : v)))} label="Closed" className="text-xs !items-center [&>input]:mt-0" />
          </div>
        );
      })}
    </div>
  );
}
