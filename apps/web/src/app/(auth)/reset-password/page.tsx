"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/brand";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(params.get("error") ? "That reset link is invalid or has expired." : null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return setError("Missing reset token.");
    const fd = new FormData(e.currentTarget);
    const a = String(fd.get("password"));
    if (a !== String(fd.get("confirm"))) return setError("Passwords don't match.");
    setBusy(true);
    const r = await authClient.resetPassword({ newPassword: a, token });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Could not reset password");
    else router.push("/sign-in?reset=1");
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="New password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus /></Field>
      <Field label="Confirm password"><Input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
      {error ? <Notice>{error}</Notice> : null}
      <Button type="submit" className="w-full" disabled={busy || !token}>{busy ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex justify-center"><Wordmark /></div>
      <h1 className="mb-4 text-center text-xl font-semibold">Choose a new password</h1>
      <Card className="p-6"><Suspense><ResetForm /></Suspense></Card>
    </main>
  );
}
