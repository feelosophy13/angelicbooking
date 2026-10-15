"use client";
import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Textarea } from "@/components/ui";
import { smsSegments } from "@/lib/sms-length";
import { replyToClient } from "../../clients/[clientId]/messages-actions";

/** Reply composer; clears itself after a send and shows how many texts the message will count as. */
export function ReplyBox({ slug, clientId, optedOut }: { slug: string; clientId: string; optedOut: boolean }) {
  const [round, setRound] = useState(0);
  const [body, setBody] = useState("");
  const { length, segments, unicode } = smsSegments(body);
  return (
    <ActionForm key={round} action={replyToClient} onSuccess={() => { setBody(""); setRound((n) => n + 1); }}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="" name="body"><Textarea name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={optedOut ? "This client has opted out of texts" : "Reply by text…"} disabled={optedOut} /></Field>
      {length > 0 ? <p className={`mb-2 text-xs ${segments > 1 ? "text-amber-700" : "text-stone-500"}`}>{length} characters · counts as {segments} text{segments === 1 ? "" : "s"}{unicode ? " (emoji or special characters shorten each text)" : ""}{length > 1000 ? " · only the first 1000 characters are sent" : ""}</p> : null}
      <SubmitButton pendingText="Sending…" disabled={optedOut}>Send text</SubmitButton>
    </ActionForm>
  );
}
