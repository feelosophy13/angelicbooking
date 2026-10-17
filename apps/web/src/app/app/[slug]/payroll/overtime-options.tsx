"use client";
import { useState } from "react";
import { Button, Checkbox } from "@/components/ui";

/**
 * The run's overtime switch, with how overtime is counted (weekly or California daily) shown only while it is on.
 * The rule saves through the separate `ot-rule` form on the page; the checkbox posts with the period form.
 */
export function OvertimeOptions({ overtime, rule }: { overtime: boolean; rule: "weekly" | "daily" }) {
  const [on, setOn] = useState(overtime);
  const daily = rule === "daily";
  return (
    <>
      <input type="hidden" name="overtime" value="0" />
      <Checkbox name="overtime" value="1" checked={on} onChange={(e) => setOn(e.target.checked)} label={daily ? "Overtime, California rules" : "Overtime at 1.5× over 40 h/week"} hint={'for hourly staff set to "follow the payroll run"'} />
      {on ? (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <label className="mb-1 block text-xs font-medium text-stone-600" htmlFor="ot-rule-select">Count overtime</label>
          <div className="flex gap-2">
            <select id="ot-rule-select" name="rule" form="ot-rule" defaultValue={rule} className="h-8 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-sm">
              <option value="weekly">Weekly: 1.5× over 40 h</option>
              <option value="daily">Daily (California)</option>
            </select>
            <Button type="submit" form="ot-rule" variant="secondary" size="sm">Save</Button>
          </div>
          <p className="mt-1 text-xs text-stone-500">{daily ? "1.5× over 8 h a day or 40 h a week, 2× over 12 h, and the 7th day in a row." : "Daily rules (California) pay 1.5× over 8 h a day and 2× over 12 h."} Commission counts toward the overtime rate.</p>
        </div>
      ) : null}
    </>
  );
}
