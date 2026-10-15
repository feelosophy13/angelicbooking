"use client";

import { useActionState } from "react";
import { PasswordField } from "@/ui/password-field";
import { resetPassword } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword.bind(null, token), null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <PasswordField name="password" label="New password" autoComplete="new-password" minLength={12} autoFocus />
      <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" minLength={12} />
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink hover:opacity-90 disabled:opacity-60">{pending ? "Saving…" : "Set new password"}</button>
    </form>
  );
}
