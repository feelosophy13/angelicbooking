"use client";
import { useState } from "react";
import { scheduleClass } from "../actions";
import { Card, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { cn } from "@/lib/utils";

export function ScheduleClassForm(props: { slug: string; serviceId: string; staffId: string; defaultCapacity: number; dateLabel: string; slots: { iso: string; label: string }[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-medium">{props.dateLabel}</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {props.slots.map((s) => (
          <button key={s.iso} type="button" onClick={() => setPicked(s.iso)} className={cn("rounded-lg border px-3 py-1.5 text-sm", picked === s.iso ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50")}>{s.label}</button>
        ))}
      </div>
      <ActionForm action={scheduleClass}>
        <input type="hidden" name="slug" value={props.slug} />
        <input type="hidden" name="serviceId" value={props.serviceId} />
        <input type="hidden" name="staffId" value={props.staffId} />
        <input type="hidden" name="startAt" value={picked ?? ""} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seats" name="capacity" hint="Leave as is to use the service's group size."><Input name="capacity" type="number" min={1} max={500} defaultValue={props.defaultCapacity} /></Field>
        </div>
        <Field label="Note for clients (optional)" name="notes" hint="Shown next to the time on the booking page."><Textarea name="notes" rows={4} placeholder="Bring a mat" /></Field>
        <SubmitButton disabled={!picked} pendingText="Scheduling…">{picked ? `Schedule at ${props.slots.find((s) => s.iso === picked)?.label}` : "Pick a time"}</SubmitButton>
      </ActionForm>
    </Card>
  );
}
