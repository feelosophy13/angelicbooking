"use client";
import { useActionState, useState } from "react";
import { book } from "./actions";
import { Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const REPEAT: { weeks: number; label: string }[] = [
  { weeks: 0, label: "Does not repeat" },
  { weeks: 1, label: "Every week" },
  { weeks: 2, label: "Every 2 weeks" },
  { weeks: 3, label: "Every 3 weeks" },
  { weeks: 4, label: "Every 4 weeks" },
  { weeks: 5, label: "Every 5 weeks" },
  { weeks: 6, label: "Every 6 weeks" },
  { weeks: 8, label: "Every 8 weeks" },
  { weeks: 12, label: "Every 12 weeks" },
];

export function BookForm(props: {
  slug: string;
  clientId: string;
  serviceId: string;
  staffId: string;
  locationId?: string | null;
  dateLabel: string;
  slots: { iso: string; label: string }[];
  preselectIso?: string | null;
}) {
  const [state, action, pending] = useActionState(book, undefined);
  const [picked, setPicked] = useState<string | null>(props.preselectIso ?? null);
  const [repeat, setRepeat] = useState(0);
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-medium">{props.dateLabel}</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {props.slots.map((s) => (
          <button
            key={s.iso}
            type="button"
            onClick={() => setPicked(s.iso)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm",
              picked === s.iso ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="slug" value={props.slug} />
        <input type="hidden" name="clientId" value={props.clientId} />
        <input type="hidden" name="serviceId" value={props.serviceId} />
        <input type="hidden" name="staffId" value={props.staffId} />
        {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
        <input type="hidden" name="startAt" value={picked ?? ""} />
        <Field label="Notes (optional)"><Textarea name="notes" rows={2} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat">
            <Select name="repeatWeeks" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              {REPEAT.map((r) => <option key={r.weeks} value={r.weeks}>{r.label}</option>)}
            </Select>
          </Field>
          {repeat > 0 ? <Field label="Number of visits" hint="Including this one; dates that clash are skipped."><Input name="repeatCount" type="number" min={2} max={52} defaultValue={6} /></Field> : null}
        </div>
        {state?.error ? <Notice>{state.error}</Notice> : null}
        <Button type="submit" disabled={!picked || pending}>
          {pending ? "Booking…" : picked ? `${repeat > 0 ? "Book series from" : "Book"} ${props.slots.find((s) => s.iso === picked)?.label}` : "Pick a time"}
        </Button>
      </form>
    </Card>
  );
}
