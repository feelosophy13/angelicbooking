"use client";
import { useActionState, useState } from "react";
import { book } from "./actions";
import { Button, Card, Field, Notice, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export function BookForm(props: {
  slug: string;
  clientId: string;
  serviceId: string;
  staffId: string;
  dateLabel: string;
  slots: { iso: string; label: string }[];
  preselectIso?: string | null;
}) {
  const [state, action, pending] = useActionState(book, undefined);
  const [picked, setPicked] = useState<string | null>(props.preselectIso ?? null);
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
        <input type="hidden" name="startAt" value={picked ?? ""} />
        <Field label="Notes (optional)"><Textarea name="notes" rows={2} /></Field>
        {state?.error ? <Notice>{state.error}</Notice> : null}
        <Button type="submit" disabled={!picked || pending}>
          {pending ? "Booking…" : picked ? `Book ${props.slots.find((s) => s.iso === picked)?.label}` : "Pick a time"}
        </Button>
      </form>
    </Card>
  );
}
