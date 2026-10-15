"use client";

import { useActionState } from "react";
import { requestReset } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, null);
  if (state?.done) return <p role="status" className="mt-6 rounded-lg bg-good-soft px-3 py-3 text-sm text-good">If that is the admin email, a reset link is on its way. It works once and expires in 30 minutes.</p>;
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" autoFocus className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink hover:opacity-90 disabled:opacity-60">{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}
