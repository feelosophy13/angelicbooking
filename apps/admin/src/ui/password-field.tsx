"use client";

import { useState } from "react";

/** A password box with a Show / Hide button (the rule is in DESIGN.md, "Forms"). */
export function PasswordField({ name, label, autoComplete, minLength, autoFocus }: { name: string; label: string; autoComplete: string; minLength?: number; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="relative mt-1 block">
        <input name={name} type={shown ? "text" : "password"} required minLength={minLength} autoComplete={autoComplete} autoFocus={autoFocus} className="w-full rounded-lg border border-line bg-surface py-2 pl-3 pr-16" />
        <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ink-3 hover:text-ink">
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
