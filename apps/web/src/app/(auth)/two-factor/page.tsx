"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/brand";

export default function TwoFactorPage() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code")).replace(/\s+/g, "");
    const trustDevice = fd.get("trust") === "on";
    const r = useBackup ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice }) : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "That code didn't work");
    else {
      router.push("/");
      router.refresh();
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex justify-center"><Wordmark /></div>
      <h1 className="mb-1 text-center text-xl font-semibold">Two-factor authentication</h1>
      <p className="mb-4 text-center text-sm text-stone-600">{useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}</p>
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label={useBackup ? "Backup code" : "Code"}><Input name="code" inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code" required autoFocus className="text-center text-lg tracking-widest" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="trust" className="h-4 w-4 accent-brand-600" /> Trust this device for 30 days</label>
          {error ? <Notice>{error}</Notice> : null}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Checking…" : "Continue"}</Button>
          <button type="button" onClick={() => setUseBackup((b) => !b)} className="w-full text-center text-xs text-brand-700 underline">{useBackup ? "Use authenticator app instead" : "Use a backup code"}</button>
        </form>
      </Card>
    </main>
  );
}
