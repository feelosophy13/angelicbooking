"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { Flash } from "@/lib/flash";
import { cn } from "@/lib/utils";

const COOKIE = "angelic_flash";

/** Shows the server-set flash message once, then clears the cookie. */
export function Toaster({ initial }: { initial: Flash | null }) {
  const [flash, setFlash] = useState<Flash | null>(initial);
  useEffect(() => {
    if (!initial) return;
    document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
    setFlash(initial);
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [initial]);
  if (!flash) return null;
  const Icon = flash.kind === "success" ? CheckCircle2 : flash.kind === "error" ? XCircle : Info;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
      <div
        role="status"
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg",
          flash.kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
          flash.kind === "error" && "border-red-200 bg-red-50 text-red-900",
          flash.kind === "info" && "border-stone-200 bg-white text-stone-800",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{flash.message}</span>
        <button onClick={() => setFlash(null)} className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
