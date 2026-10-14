"use client";

import { useActionState, useState } from "react";
import { login } from "./actions";

export function LoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  const [shown, setShown] = useState(false);
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Password</span>
        <span className="relative mt-1 block">
          <input name="password" type={shown ? "text" : "password"} required autoComplete="current-password" className="w-full rounded-lg border border-line bg-surface py-2 pl-3 pr-16" />
          <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-3 hover:text-ink">
            {shown ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink hover:opacity-90 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
