"use client";
import { useState } from "react";
import { PAY_FREQUENCY_LABEL, type PayFrequency } from "@angelic/core";
import { Input, Select } from "@/components/ui";
import { Field } from "@/components/form";

/**
 * The business's pay schedule: how often payroll runs and, for weekly and biweekly, a day any period starts on. The week start is the
 * calendar's own setting (Settings → Business profile) shown here because overtime is counted per that workweek. Used by the Payroll
 * page's Options and by Settings → Payroll rules, so the two never drift.
 */
export function PayScheduleFields({ frequency, anchor, weekStart }: { frequency: PayFrequency | null; anchor: string | null; weekStart: number }) {
  const [freq, setFreq] = useState<PayFrequency>(frequency ?? "biweekly");
  const anchored = freq === "weekly" || freq === "biweekly";
  return (
    <>
      <Field label="Pay period" name="frequency" hint={frequency ? undefined : "Not set yet: periods are assumed to be two weeks from the last finalized one."}>
        <Select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value as PayFrequency)}>
          {(Object.keys(PAY_FREQUENCY_LABEL) as PayFrequency[]).map((k) => <option key={k} value={k}>{PAY_FREQUENCY_LABEL[k]}</option>)}
        </Select>
      </Field>
      {anchored ? (
        <Field label="A period starts on" name="anchor" hint="Any first day of a pay period, past or future; the others follow from it." required>
          <Input type="date" name="anchor" defaultValue={anchor ?? ""} required />
        </Field>
      ) : null}
      <Field label="Week starts on" name="weekStart" hint="The calendar's week and the overtime workweek.">
        <Select name="weekStart" defaultValue={String(weekStart)}>
          <option value="0">Sunday</option>
          <option value="1">Monday</option>
          <option value="6">Saturday</option>
        </Select>
      </Field>
    </>
  );
}
