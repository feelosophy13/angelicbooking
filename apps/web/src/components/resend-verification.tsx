"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** "Send it again" for the verification email, shown in the banner that asks a new owner to verify. */
export function ResendVerification({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function send() {
    setState("sending");
    const res = await authClient.sendVerificationEmail({ email, callbackURL });
    setState(res.error ? "error" : "sent");
  }
  if (state === "sent") return <span>We sent a new link to {email}.</span>;
  return (
    <button type="button" onClick={send} disabled={state === "sending"} className="underline hover:text-stone-900 disabled:opacity-60">
      {state === "sending" ? "Sending…" : state === "error" ? "Couldn't send, try again" : "Send the link again"}
    </button>
  );
}
