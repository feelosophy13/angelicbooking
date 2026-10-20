"use client";
import { useEffect, useState, useTransition } from "react";
import { Delete, HandCoins, X } from "lucide-react";
import { Button } from "@/components/ui";
import { brandVars } from "@/lib/brand";
import { cn } from "@/lib/utils";
import type { SaleActionState } from "./actions";

type Step = "choose" | "custom" | "confirm" | "thanks";

/**
 * The client-facing tip screen: staff tap "Ask the client" and turn the device around. The screen fills the display in the
 * business's brand color, offers the salon's tip choices, another amount or no tip, asks the client to confirm, and saves
 * the tip on the ticket with the same action as the staff tip form (one stylist gets it all; several split it by revenue).
 * It works with any way of taking the card afterwards, because the tip is part of the total before payment starts.
 */
export function ClientTipScreen(props: {
  slug: string;
  saleId: string;
  action: (prev: SaleActionState, fd: FormData) => Promise<SaleActionState>;
  /** What a percentage is worked out on: goods after discount, before tax. */
  baseCents: number;
  /** The ticket total without any tip. */
  totalBeforeTipCents: number;
  currency: string;
  presets: number[];
  /** Who the tip goes to: one id gets it all; "" splits it across the stylists by revenue. */
  target: string;
  staffNames: string[];
  business: { name: string; logoUrl: string | null; brandColor: string | null };
  clientFirstName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [tipCents, setTipCents] = useState(0);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: props.currency }).format(c / 100);
  const forWhom = props.staffNames.length === 1 ? props.staffNames[0] : props.staffNames.length === 2 ? `${props.staffNames[0]} and ${props.staffNames[1]}` : "your team";

  // Fill the screen while the client chooses (where the browser allows it), and let go when the screen closes.
  useEffect(() => {
    if (!open) return;
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
  }, [open]);

  const begin = () => { setStep("choose"); setTipCents(0); setTyped(""); setError(null); setOpen(true); };
  const pick = (cents: number) => { setTipCents(cents); setStep("confirm"); };
  const press = (k: string) => setTyped((t) => (k === "back" ? t.slice(0, -1) : (t + k).replace(/^0+/, "").slice(0, 6)));
  const typedCents = Number(typed || "0");
  const save = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("slug", props.slug);
      fd.set("saleId", props.saleId);
      fd.set(`tip_${props.target}`, (tipCents / 100).toFixed(2));
      fd.set(`tipby_${props.target}`, "");
      const r = await props.action(undefined, fd);
      if (r?.error) setError(r.error);
      else setStep("thanks");
    });

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={begin}><HandCoins className="h-4 w-4" aria-hidden /> Ask the client</Button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Add a tip" className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-white text-stone-900" style={brandVars(props.business.brandColor)}>
          <div className="flex items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {props.business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={props.business.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-stone-200 object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white" style={{ background: "var(--brand)" }}>{props.business.name.slice(0, 1)}</span>
              )}
              <span className="truncate font-semibold">{props.business.name}</span>
            </div>
            {step !== "thanks" ? (
              <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Close the tip screen (staff)">
                <X className="h-4 w-4" aria-hidden /> Staff: close
              </button>
            ) : null}
          </div>

          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 pb-8 sm:px-6">
            {step === "choose" ? (
              <>
                <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{props.clientFirstName ? `Thanks, ${props.clientFirstName}!` : "Thank you!"}</h2>
                <p className="mt-2 text-center text-stone-600">Would you like to add a tip for {forWhom}?</p>
                <p className="mt-1 text-center text-sm text-stone-500">Your total is {money(props.totalBeforeTipCents)}</p>
                <div className={cn("mt-6 grid gap-3", props.presets.length === 4 ? "grid-cols-2" : props.presets.length === 1 ? "grid-cols-1" : props.presets.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
                  {props.presets.map((p) => {
                    const cents = Math.round((props.baseCents * p) / 100);
                    return (
                      <button key={p} type="button" onClick={() => pick(cents)} className="flex min-h-24 flex-col items-center justify-center rounded-2xl px-2 py-4 text-white shadow-sm transition active:scale-[0.98]" style={{ background: "var(--brand)" }}>
                        <span className="text-2xl font-semibold sm:text-3xl">{p}%</span>
                        <span className="mt-0.5 text-sm opacity-90">{money(cents)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => { setTyped(""); setStep("custom"); }} className="min-h-14 rounded-2xl border-2 border-stone-200 font-medium hover:bg-stone-50">Other amount</button>
                  <button type="button" onClick={() => pick(0)} className="min-h-14 rounded-2xl border-2 border-stone-200 font-medium hover:bg-stone-50">No tip</button>
                </div>
              </>
            ) : step === "custom" ? (
              <>
                <h2 className="text-center text-xl font-semibold">Enter a tip</h2>
                <p className="mt-4 text-center text-5xl font-semibold tabular-nums" aria-live="polite">{money(typedCents)}</p>
                <div className="mx-auto mt-6 grid w-full max-w-xs grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map((k) => (
                    <button key={k} type="button" onClick={() => press(k)} aria-label={k === "back" ? "Delete" : k} className="flex h-14 items-center justify-center rounded-xl bg-stone-100 text-xl font-medium hover:bg-stone-200 active:scale-[0.98]">
                      {k === "back" ? <Delete className="h-5 w-5" aria-hidden /> : k}
                    </button>
                  ))}
                </div>
                <div className="mx-auto mt-4 grid w-full max-w-xs grid-cols-2 gap-2">
                  <button type="button" onClick={() => setStep("choose")} className="min-h-12 rounded-xl border-2 border-stone-200 font-medium">Back</button>
                  <button type="button" onClick={() => pick(typedCents)} className="min-h-12 rounded-xl font-medium text-white" style={{ background: "var(--brand)" }}>Continue</button>
                </div>
              </>
            ) : step === "confirm" ? (
              <>
                <h2 className="text-center text-xl font-semibold">{tipCents > 0 ? `Tip ${money(tipCents)}` : "No tip"}</h2>
                <p className="mt-3 text-center text-stone-600">New total</p>
                <p className="text-center text-5xl font-semibold tabular-nums">{money(props.totalBeforeTipCents + tipCents)}</p>
                {error ? <p role="alert" className="mt-4 text-center text-sm text-red-700">{error}</p> : null}
                <div className="mx-auto mt-8 grid w-full max-w-sm grid-cols-2 gap-3">
                  <button type="button" onClick={() => setStep("choose")} disabled={pending} className="min-h-14 rounded-2xl border-2 border-stone-200 font-medium">Change</button>
                  <button type="button" onClick={save} disabled={pending} className="min-h-14 rounded-2xl font-semibold text-white disabled:opacity-70" style={{ background: "var(--brand)" }}>{pending ? "Saving…" : "Confirm"}</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-center text-3xl font-semibold tracking-tight">Thank you!</h2>
                <p className="mt-2 text-center text-stone-600">Please hand the device back to pay.</p>
                <div className="mt-8 flex justify-center">
                  <button type="button" onClick={() => setOpen(false)} className="min-h-12 rounded-xl border-2 border-stone-200 px-6 font-medium">Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
