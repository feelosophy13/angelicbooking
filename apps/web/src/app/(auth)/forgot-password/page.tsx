"use client";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/brand";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email"));
    const r = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Something went wrong");
    else setSent(true);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex justify-center"><Wordmark /></div>
      <h1 className="mb-4 text-center text-xl font-semibold">Reset your password</h1>
      <Card className="p-6">
        {sent ? (
          <Notice kind="success">If an account exists for that email, a reset link is on its way. It expires in one hour.</Notice>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email"><Input name="email" type="email" required autoComplete="email" autoFocus /></Field>
            {error ? <Notice>{error}</Notice> : null}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
          </form>
        )}
      </Card>
      <p className="mt-4 text-center text-sm text-stone-600"><Link className="text-brand-700 underline" href="/sign-in">Back to sign in</Link></p>
    </main>
  );
}
