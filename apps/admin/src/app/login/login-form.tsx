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
        <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Password</span>
        <span className="relative mt-1 block">
          <input name="password" type={shown ? "text" : "password"} required autoComplete="current-password" className="w-full rounded-md border border-stone-300 bg-white py-2 pl-3 pr-16" />
          <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-stone-500 hover:text-stone-900">
            {shown ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
