"use client";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui";

type Draft<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The one button every AI draft starts from: a quiet "sparkles" button that asks the server for a draft and hands it to `onDraft`
 * (which drops it into a field for the person to edit). A failure shows as a grey line beside it. Only rendered when the server
 * has the assistant set up.
 */
export function AiButton<T>({ label, pendingLabel = "Writing…", run, onDraft, className }: { label: string; pendingLabel?: string; run: () => Promise<Draft<T>>; onDraft: (value: T) => void; className?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await run();
            if (r.ok) onDraft(r.value);
            else setError(r.error);
          })
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-brand-600" />}
        {pending ? pendingLabel : label}
      </Button>
      {error ? <span role="status" className="text-xs text-stone-500">{error}</span> : null}
    </span>
  );
}
