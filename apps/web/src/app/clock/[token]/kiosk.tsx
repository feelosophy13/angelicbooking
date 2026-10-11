"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { punchAction, type PunchState } from "./actions";

/** PIN pad for the clock-in kiosk. Shows the result for a few seconds, then resets for the next person. */
export function Kiosk({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PunchState, FormData>(punchAction, undefined);
  const [pin, setPin] = useState("");
  const [shown, setShown] = useState<PunchState>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    setShown(state);
    setPin("");
    if (!state) return;
    const t = setTimeout(() => setShown(undefined), state.punch ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [state]);
  const time = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  const press = (k: string) => {
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (pin.length >= 6) return;
    setPin((p) => p + k);
  };
  return (
    <div className="mx-auto w-full max-w-xs">
      {shown?.punch ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center" role="status">
          <p className="text-lg font-semibold text-emerald-800">{shown.punch.staffName}</p>
          <p className="text-emerald-800">{shown.punch.action === "in" ? "Clocked in" : "Clocked out"} at {time(new Date(shown.punch.at), shown.punch.timeZone)}</p>
          {shown.punch.minutes ? <p className="text-sm text-emerald-700">{(shown.punch.minutes / 60).toFixed(2)} hours this shift</p> : null}
        </div>
      ) : shown?.error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700" role="alert">{shown.error}</div>
      ) : (
        <p className="mb-4 text-center text-sm text-stone-600">Enter your PIN to clock in or out.</p>
      )}
      <form ref={formRef} action={action} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="pin" value={pin} />
        <div className="flex h-14 items-center justify-center gap-3 rounded-2xl border border-stone-200 bg-white text-3xl tracking-[0.5em]" aria-label="PIN" aria-live="polite">
          {pin ? "•".repeat(pin.length) : <span className="text-base tracking-normal text-stone-300">PIN</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} className="h-14 rounded-2xl border border-stone-200 bg-white text-2xl font-medium text-stone-800 active:bg-stone-100" aria-label={k === "⌫" ? "Delete" : k}>{k}</button>
          ))}
          <button type="submit" disabled={pending || pin.length < 4} className="h-14 rounded-2xl text-lg font-semibold text-white disabled:opacity-40" style={{ background: "var(--brand)" }}>{pending ? "…" : "Go"}</button>
        </div>
      </form>
    </div>
  );
}
