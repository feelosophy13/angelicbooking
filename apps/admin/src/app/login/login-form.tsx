"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2" />
      </label>
      {needsCode && (
        <label className="block text-sm">
          <span className="font-medium">Authenticator code</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 tracking-widest" />
        </label>
      )}
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
