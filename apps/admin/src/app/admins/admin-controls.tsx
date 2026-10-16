"use client";

import { useActionState, useState, useTransition } from "react";
import { inviteAdmin, setDisabled, type AdminsState } from "./actions";
import { BTN, BTN_PRIMARY, INPUT } from "@/ui/kit";

export function InviteForm() {
  const [state, act, pending] = useActionState(inviteAdmin, null);
  return (
    <form action={act} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input name="email" type="email" required placeholder="Email" aria-label="Email" className={INPUT} />
      <input name="name" placeholder="Name (optional)" aria-label="Name" className={INPUT} />
      <button className={BTN_PRIMARY} disabled={pending}>{pending ? "Adding…" : "Add admin"}</button>
      {state?.error ? <p role="alert" className="text-sm text-bad sm:col-span-3">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-good sm:col-span-3">{state.ok}</p> : null}
    </form>
  );
}

export function ToggleDisabled({ id, disabled, self }: { id: string; disabled: boolean; self: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AdminsState>(null);
  if (self) return <span className="text-xs text-ink-3">You</span>;
  return (
    <span className="flex items-center gap-2">
      <button className={BTN} disabled={pending} onClick={() => start(async () => setMsg(await setDisabled(id, !disabled)))}>{disabled ? "Enable" : "Disable"}</button>
      {msg?.error ? <span role="alert" className="text-xs text-bad">{msg.error}</span> : null}
    </span>
  );
}
