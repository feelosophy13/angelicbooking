"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PasswordField } from "@/ui/password-field";
import { login } from "./actions";

export function LoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      <PasswordField name="password" label="Password" autoComplete="current-password" />
      {needsCode && (
        <label className="block text-sm">
          <span className="font-medium">Authenticator code</span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 tracking-widest" />
        </label>
      )}
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink hover:opacity-90 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm"><Link href="/forgot-password" className="text-ink-2 underline hover:text-ink">Forgot your password?</Link></p>
    </form>
  );
}
