"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies `text` to the clipboard; shows a tick for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="hit inline-flex h-7 items-center gap-1 rounded-md bg-white/10 px-2 text-xs text-stone-200 hover:bg-white/20"
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}
