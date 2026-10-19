"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { Flash, FlashKind } from "@/lib/flash";
import { cn } from "@/lib/utils";

const COOKIE = "angelic_flash";
const EVENT = "app:toast";

export type ToastInput = { message: string; kind?: FlashKind; /** One quiet action on the toast, e.g. Undo. */ action?: { label: string; onClick: () => void }; /** How long it stays, ms (default 4.5 s; an Undo toast stays longer). */ ttlMs?: number };
type Toast = ToastInput & { id: number };

/**
 * Show a toast from client code (a drag, a quick action), the same look as the server's `setFlash`. One at a time: a new toast replaces
 * the one on screen, and its action (Undo) goes with it, so there is never a stack to read.
 */
export function toast(input: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(EVENT, { detail: input }));
}

/** Shows the server-set flash message once (then clears the cookie), and any toast raised on the page. */
export function Toaster({ initial }: { initial: Flash | null }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  useEffect(() => {
    if (!initial) return;
    document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
    setCurrent({ id: Date.now(), message: initial.message, kind: initial.kind });
  }, [initial]);
  useEffect(() => {
    const onToast = (e: Event) => setCurrent({ id: Date.now(), ...(e as CustomEvent<ToastInput>).detail });
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent((c) => (c?.id === current.id ? null : c)), current.ttlMs ?? (current.action ? 8000 : 4500));
    return () => clearTimeout(t);
  }, [current]);
  if (!current) return null;
  const kind = current.kind ?? "success";
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? XCircle : Info;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
      <div
        role="status"
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg",
          kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
          kind === "error" && "border-red-200 bg-red-50 text-red-900",
          kind === "info" && "border-stone-200 bg-white text-stone-800",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{current.message}</span>
        {current.action ? (
          <button type="button" onClick={() => { current.action!.onClick(); setCurrent(null); }} className="ml-1 rounded-md px-2 py-0.5 font-semibold underline-offset-2 hover:underline">
            {current.action.label}
          </button>
        ) : null}
        <button onClick={() => setCurrent(null)} className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
