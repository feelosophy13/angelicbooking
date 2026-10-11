"use client";
import { useActionState } from "react";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeForm({ slug, token, businessName }: { slug: string; token: string; businessName: string }) {
  const [state, action] = useActionState<UnsubscribeState, FormData>(unsubscribeAction, undefined);
  if (state?.ok) return <p>You&apos;re unsubscribed from emails from {businessName}. Appointment confirmations and receipts for bookings you make are still sent.</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <p>Unsubscribe from marketing emails from {businessName}? Appointment confirmations and receipts are still sent.</p>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton variant="secondary" pendingText="Saving…">Unsubscribe</SubmitButton>
    </form>
  );
}
