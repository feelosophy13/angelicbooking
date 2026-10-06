"use client";
import { useActionState, useState } from "react";
import { cancelBooking, rescheduleBooking, type PublicState } from "../../actions";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

export function CancelForm({ slug, token }: { slug: string; token: string }) {
  const [state, action, pending] = useActionState<PublicState, FormData>(cancelBooking, undefined);
  const [confirm, setConfirm] = useState(false);
  if (state?.ok) return <Notice kind="success">Your appointment has been cancelled.</Notice>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      {!confirm ? (
        <Button type="button" variant="secondary" onClick={() => setConfirm(true)}>Cancel this appointment</Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="submit" variant="danger" disabled={pending}>{pending ? "…" : "Yes, cancel it"}</Button>
          <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
        </div>
      )}
    </form>
  );
}

export function RescheduleForm({ slug, token, slots, dateLabel }: { slug: string; token: string; slots: { iso: string; label: string }[]; dateLabel: string }) {
  const [state, action, pending] = useActionState<PublicState, FormData>(rescheduleBooking, undefined);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="startAt" value={picked ?? ""} />
      <p className="text-sm font-medium">{dateLabel}</p>
      <div className="flex flex-wrap gap-2">
        {slots.map((s) => (
          <button key={s.iso} type="button" onClick={() => setPicked(s.iso)} className={cn("rounded-lg border px-3 py-1.5 text-sm", picked === s.iso ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50")}>{s.label}</button>
        ))}
      </div>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" disabled={!picked || pending}>{pending ? "Moving…" : picked ? "Move to this time" : "Pick a time"}</Button>
    </form>
  );
}
