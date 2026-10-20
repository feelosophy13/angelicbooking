"use client";
import { useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { checkBookingCodeAction, sendBookingCodeAction } from "./actions";

type Sent = { channel: "sms" | "email"; to: string; phone: string; email: string };

/**
 * The booking code step, shared by the free and the paid booking forms. `ensure` is called with the typed phone and email when the
 * client presses the booking button: it resolves true when the booking may go ahead (no code needed, or already proven on this page),
 * otherwise it sends a code and shows `panel`, and `onVerified` runs once the code is right so the form can carry on.
 */
export function useBookingVerification(slug: string, required: boolean, onVerified: (token: string) => void, /** The form's current bot-check answer, for "Send it again" (the widget resets after every send). */ botAnswer?: () => string | null) {
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after every send so the form resets its bot check: each answer works once.
  const [sends, setSends] = useState(0);

  async function send(phone: string, email: string, via?: "sms" | "email", botToken?: string | null): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await sendBookingCodeAction({ slug, phone, email, via, token, botToken: botToken ?? botAnswer?.() ?? null });
    setSends((n) => n + 1);
    setBusy(false);
    if ("verified" in r) return true;
    if ("error" in r) { setError(r.error); setSent(null); return false; }
    setSent({ ...r, phone, email });
    setCode("");
    return false;
  }

  /** `botToken` is the form's bot-check answer (cf-turnstile-response), checked when the code is sent. */
  async function ensure(phone: string, email: string, botToken?: string | null): Promise<boolean> {
    if (!required || token) return true;
    return send(phone, email, undefined, botToken);
  }

  async function verify() {
    if (!sent) return;
    setBusy(true);
    setError(null);
    const r = await checkBookingCodeAction({ slug, phone: sent.phone, email: sent.email, channel: sent.channel, code });
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setToken(r.token);
    setSent(null);
    onVerified(r.token);
  }

  const panel = sent ? (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3" role="group" aria-label="Confirm your contact details">
      <p className="text-sm">We sent a 6-digit code to <span className="font-medium">{sent.to}</span>. Enter it to confirm it&apos;s you.</p>
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (code.length === 6) void verify(); } }} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code" className="max-w-[10rem] text-center font-mono tracking-[0.3em]" autoFocus />
        <Button type="button" onClick={verify} disabled={busy || code.length !== 6} style={{ background: "var(--brand)" }}>{busy ? "Checking…" : "Confirm"}</Button>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
        <button type="button" className="underline" disabled={busy} onClick={() => void send(sent.phone, sent.email, sent.channel)}>Send it again</button>
        {sent.channel === "sms" && sent.email ? <button type="button" className="underline" disabled={busy} onClick={() => void send(sent.phone, sent.email, "email")}>Email it to me instead</button> : null}
        {sent.channel === "email" ? <button type="button" className="underline" disabled={busy} onClick={() => void send(sent.phone, sent.email, "sms")}>Text it to me instead</button> : null}
      </p>
    </div>
  ) : error ? (
    <Notice>{error}</Notice>
  ) : null;

  return { token, ensure, panel, waiting: !!sent, busy, sends };
}
