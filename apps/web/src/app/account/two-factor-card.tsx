"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "password" | "verify" | "disable">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [backup, setBackup] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const r = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.message ?? "Could not start setup");
    if (!("totpURI" in r.data)) return setError("Authenticator setup is not available.");
    setUri(r.data.totpURI);
    setBackup(r.data.backupCodes);
    setQr(await QRCode.toDataURL(r.data.totpURI, { margin: 1, width: 180 }));
    setStep("verify");
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s+/g, "");
    const r = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (r.error) return setError(r.error.message ?? "That code didn't work");
    setStep("idle");
    router.refresh();
  }
  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const r = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (r.error) return setError(r.error.message ?? "Could not turn off");
    setStep("idle");
    router.refresh();
  }

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        {enabled ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldOff className="h-5 w-5 text-stone-400" />}
        <h2 className="font-medium">Two-factor authentication</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"}`}>{enabled ? "On" : "Off"}</span>
      </div>
      <p className="mb-3 text-sm text-stone-600">Adds a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy) when you sign in.</p>
      {error ? <div className="mb-3"><Notice>{error}</Notice></div> : null}
      {step === "idle" && !enabled ? <Button variant="secondary" onClick={() => setStep("password")}>Turn on</Button> : null}
      {step === "idle" && enabled ? <Button variant="ghost" onClick={() => setStep("disable")}>Turn off</Button> : null}
      {step === "password" || step === "disable" ? (
        <form onSubmit={step === "password" ? start : disable} className="space-y-3">
          <Field label="Confirm your password"><Input name="password" type="password" required autoComplete="current-password" autoFocus /></Field>
          <div className="flex gap-2">
            <Button type="submit" variant={step === "disable" ? "danger" : "primary"} disabled={busy}>{busy ? "…" : step === "disable" ? "Turn off 2FA" : "Continue"}</Button>
            <Button type="button" variant="ghost" onClick={() => setStep("idle")}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {step === "verify" ? (
        <div className="space-y-3">
          <p className="text-sm">1. Scan this code with your authenticator app{uri ? <> or <a className="text-brand-700 underline" href={uri}>open it directly</a></> : null}.</p>
          {qr ? <img src={qr} alt="Authenticator QR code" className="rounded-lg border border-stone-200" width={180} height={180} /> : null}
          <p className="text-sm">2. Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
          <pre className="rounded-lg bg-stone-100 p-3 font-mono text-xs">{backup.join("\n")}</pre>
          <form onSubmit={verify} className="space-y-3">
            <Field label="3. Enter the 6-digit code to finish"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required className="w-40 text-center text-lg tracking-widest" /></Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Verify and turn on"}</Button>
              <Button type="button" variant="ghost" onClick={() => setStep("idle")}>Cancel</Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
