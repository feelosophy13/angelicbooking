"use client";
import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Textarea } from "@/components/ui";
import { replyToClient } from "../../clients/[clientId]/messages-actions";

/** Reply composer; clears itself after a send. */
export function ReplyBox({ slug, clientId, optedOut }: { slug: string; clientId: string; optedOut: boolean }) {
  const [round, setRound] = useState(0);
  return (
    <ActionForm key={round} action={replyToClient} onSuccess={() => setRound((n) => n + 1)}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="" name="body"><Textarea name="body" rows={3} placeholder={optedOut ? "This client has opted out of texts" : "Reply by text…"} disabled={optedOut} /></Field>
      <SubmitButton pendingText="Sending…" disabled={optedOut}>Send text</SubmitButton>
    </ActionForm>
  );
}
