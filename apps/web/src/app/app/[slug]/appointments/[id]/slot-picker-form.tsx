"use client";
import { useActionState, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ActionState } from "./actions";

/** Shared "pick a time, then submit" form for adding or moving a service. */
export function SlotPickerForm(props: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  slots: { iso: string; label: string }[];
  submitLabel: string;
  emptyText: string;
}) {
  const [state, action, pending] = useActionState(props.action, undefined);
  const [picked, setPicked] = useState<string | null>(null);
  if (props.slots.length === 0) return <p className="text-sm text-stone-500">{props.emptyText}</p>;
  return (
    <form action={action} className="space-y-3">
      {Object.entries(props.hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="startAt" value={picked ?? ""} />
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {props.slots.map((s) => (
          <button
            key={s.iso}
            type="button"
            onClick={() => setPicked(s.iso)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              picked === s.iso ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" size="sm" disabled={!picked || pending}>
        {pending ? "Saving…" : props.submitLabel}
      </Button>
    </form>
  );
}
