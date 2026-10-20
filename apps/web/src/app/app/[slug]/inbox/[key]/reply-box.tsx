"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Textarea } from "@/components/ui";
import { smsSegments } from "@/lib/sms-length";
import { renderQuickReply, type QuickReply, type QuickReplyContext } from "@/lib/notify/quick-replies";
import { replyToClient } from "./actions";

/**
 * The composer under a thread. Enter sends (Shift+Enter for a new line); a quick reply
 * drops its wording in with the client's name and next visit filled in; a paperclip attaches
 * one picture. It clears itself after a send and shows how many texts a long message counts as.
 */
export function ReplyBox({ slug, clientId, quickReplies, context }: { slug: string; clientId: string; quickReplies: QuickReply[]; context: QuickReplyContext }) {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [body, setBody] = useState("");
  const [picture, setPicture] = useState<{ name: string; url: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { length, segments, unicode } = smsSegments(body);
  const clearPicture = () => {
    if (file.current) file.current.value = "";
    if (picture) URL.revokeObjectURL(picture.url);
    setPicture(null);
  };
  return (
    <ActionForm
      key={round}
      action={replyToClient}
      className="space-y-2"
      onSuccess={() => {
        setBody("");
        clearPicture();
        setRound((n) => n + 1);
        router.refresh();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="clientId" value={clientId} />
      {quickReplies.length ? (
        <div className="flex flex-wrap gap-1.5">
          {quickReplies.map((r) => (
            <button key={r.title} type="button" onClick={() => { setBody(renderQuickReply(r.body, context)); box.current?.focus(); }} className="rounded-full bg-stone-100 px-3 py-2 text-sm text-stone-700 hover:bg-stone-200 lg:pointer-fine:px-2.5 lg:pointer-fine:py-1 lg:pointer-fine:text-xs" title={r.body}>{r.title}</button>
          ))}
        </div>
      ) : null}
      <Field label="" name="body">
        <Textarea
          ref={box}
          name="body"
          rows={2}
          value={body}
          autoFocus
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (body.trim() || picture) e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Text the client… (Enter sends, Shift+Enter for a new line)"
        />
      </Field>
      <Field label="" name="image">
        <input ref={file} type="file" name="image" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; clearPicture(); if (f) setPicture({ name: f.name, url: URL.createObjectURL(f) }); }} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingText="Sending…">Send</SubmitButton>
        {picture ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-600">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={picture.url} alt="" className="h-8 w-8 rounded object-cover" />
            <span className="max-w-32 truncate">{picture.name}</span>
            <button type="button" onClick={clearPicture} aria-label="Remove picture" className="hit rounded p-0.5 text-stone-500 hover:bg-stone-100"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <button type="button" onClick={() => file.current?.click()} className="inline-flex items-center gap-1 py-2.5 text-xs text-stone-500 hover:text-stone-800 lg:pointer-fine:py-0"><Paperclip className="h-3.5 w-3.5" /> Picture</button>
        )}
        {length > 0 ? <span className={`ml-auto text-xs ${segments > 1 ? "text-amber-700" : "text-stone-400"}`}>{length} characters · {segments} text{segments === 1 ? "" : "s"}{unicode ? " (emoji shorten each text)" : ""}{length > 1000 ? " · only the first 1000 characters are sent" : ""}</span> : null}
      </div>
    </ActionForm>
  );
}
