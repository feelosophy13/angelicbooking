"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { askChatAction } from "./chat-actions";

type Turn = { role: "user" | "assistant"; text: string };

/** Links in an answer: only to this salon's own booking site become clickable; anything else stays plain text. */
function Linked({ text, base }: { text: string; base: string }) {
  const parts = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 $2").split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const url = p.replace(/[.,]+$/, "");
        if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
        return url.startsWith(base) ? <span key={i}><a href={url} className="font-medium underline" style={{ color: "var(--brand-dark)" }}>{url.includes("?service=") ? "Book this" : "Book online"}</a>{p.slice(url.length)}</span> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

/**
 * "Questions?" on the booking page: a small chat that answers from the salon's services, hours and policy (server/ai-features.ts
 * chatContext) and links to booking. Nothing typed here is stored; the conversation lives in this tab only.
 */
export function BookingChat({ slug, name, base }: { slug: string; name: string; base: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);
  const ask = () => {
    const q = text.trim();
    if (!q || pending) return;
    const next = [...turns, { role: "user" as const, text: q.slice(0, 500) }];
    setTurns(next);
    setText("");
    setError(null);
    start(async () => {
      const r = await askChatAction(slug, next);
      if (r.ok) setTurns((cur) => [...cur, { role: "assistant", text: r.text }]);
      else setError(r.error);
    });
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg" style={{ background: "var(--brand)" }}>
        <MessageCircle className="h-4 w-4" /> Questions?
      </button>
    );
  }
  return (
    <div role="dialog" aria-label={`Questions for ${name}`} className="fixed inset-x-3 bottom-3 z-40 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:inset-x-auto sm:right-4 sm:w-96">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <p className="text-sm font-semibold text-stone-900">Ask {name}</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="hit rounded p-1 text-stone-500 hover:bg-stone-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {turns.length === 0 ? <p className="text-stone-500">Ask about services, prices, hours or our policies. Answers come from an AI assistant using the salon&apos;s own information; please don&apos;t share personal details.</p> : null}
        {turns.map((t, i) => (
          <p key={i} className={t.role === "user" ? "ml-8 whitespace-pre-line rounded-2xl rounded-br-sm bg-stone-100 px-3 py-2 text-stone-800" : "mr-8 whitespace-pre-line rounded-2xl rounded-bl-sm border border-stone-200 px-3 py-2 text-stone-800"}>
            {t.role === "assistant" ? <Linked text={t.text} base={base} /> : t.text}
          </p>
        ))}
        {pending ? <p className="mr-8 inline-flex items-center gap-2 text-stone-500"><Loader2 className="h-4 w-4 animate-spin" /> Typing…</p> : null}
        {error ? <p role="status" className="text-xs text-stone-500">{error}</p> : null}
        <div ref={end} />
      </div>
      <form className="flex items-center gap-2 border-t border-stone-100 p-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Type a question…" aria-label="Your question" className="h-10 min-w-0 flex-1 rounded-lg border border-stone-300 px-3 text-base sm:text-sm" />
        <button type="submit" disabled={!text.trim() || pending} aria-label="Send" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white disabled:opacity-50" style={{ background: "var(--brand)" }}><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
