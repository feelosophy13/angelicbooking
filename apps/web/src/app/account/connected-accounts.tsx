"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Card } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { unlinkGoogle } from "./actions";

export function ConnectedAccounts({ googleEnabled, googleLinked, hasPassword, googleEmail, googleAccountId }: { googleEnabled: boolean; googleLinked: boolean; hasPassword: boolean; googleEmail?: string | null; googleAccountId?: string | null }) {
  const [busy, setBusy] = useState(false);
  if (!googleEnabled && !googleLinked) return null;
  async function connect() {
    setBusy(true);
    const res = await authClient.linkSocial({ provider: "google", callbackURL: "/account" });
    if (res.error) setBusy(false);
  }
  return (
    <Card className="p-5">
      <h2 className="mb-1 font-medium">Connected accounts</h2>
      <p className="mb-3 text-sm text-stone-600">Sign in with one click using an account you already have.</p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
        <div>
          <p className="font-medium">Google</p>
          <p className="text-xs text-stone-500">{googleLinked ? (googleEmail ? `Connected as ${googleEmail}` : "Connected") : "Not connected"}</p>
        </div>
        {googleLinked ? (
          hasPassword ? (
            <form action={unlinkGoogle}>
              <input type="hidden" name="accountId" value={googleAccountId ?? ""} />
              <ConfirmSubmit title="Disconnect Google?" body="You'll sign in with your email and password from then on." confirmLabel="Disconnect" variant="secondary">Disconnect</ConfirmSubmit>
            </form>
          ) : (
            <span className="text-xs text-stone-500">Set a password before disconnecting</span>
          )
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={connect} disabled={busy}>{busy ? "Opening Google…" : "Connect"}</Button>
        )}
      </div>
    </Card>
  );
}
