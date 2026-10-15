"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice } from "@/components/ui";
import { finishCardPayment, startTerminalPayment, terminalLocation, terminalToken } from "./actions";

// The slice of Stripe's Terminal JS SDK (https://js.stripe.com/terminal/v1/) this screen uses.
type Failure = { error: { message: string } };
type Reader = { id: string; label?: string | null; serial_number?: string; status?: string };
type Terminal = {
  discoverReaders: (cfg: { simulated?: boolean; location?: string }) => Promise<Failure | { discoveredReaders: Reader[] }>;
  connectReader: (r: Reader) => Promise<Failure | { reader: Reader }>;
  getConnectedReader: () => Reader | null;
  collectPaymentMethod: (clientSecret: string) => Promise<Failure | { paymentIntent: unknown }>;
  processPayment: (pi: unknown) => Promise<Failure | { paymentIntent: { id: string } }>;
  cancelCollectPaymentMethod: () => Promise<unknown>;
};
type TerminalSdk = { create: (cfg: { onFetchConnectionToken: () => Promise<string>; onUnexpectedReaderDisconnect: () => void }) => Terminal };
declare global {
  interface Window {
    StripeTerminal?: TerminalSdk;
  }
}

let sdkLoading: Promise<TerminalSdk> | null = null;
function loadStripeTerminal(): Promise<TerminalSdk | null> {
  if (window.StripeTerminal) return Promise.resolve(window.StripeTerminal);
  sdkLoading ??= new Promise<TerminalSdk>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://js.stripe.com/terminal/v1/";
    el.onload = () => (window.StripeTerminal ? resolve(window.StripeTerminal) : reject(new Error("The card reader library did not start.")));
    el.onerror = () => { sdkLoading = null; reject(new Error("The card reader library could not load. Check the connection and try again.")); };
    document.head.appendChild(el);
  });
  return sdkLoading;
}

type Step = "idle" | "connecting" | "pick" | "waiting" | "processing";

/**
 * Take a card on a Stripe card reader (tap, dip or swipe). The browser's Terminal SDK finds the readers registered
 * to this salon location (internet readers such as the WisePOS E or Stripe Reader S700), collects the card, and the
 * server records the payment the same way it does for a typed card. In Stripe's test mode a simulated reader is used.
 */
export function TerminalPayment({ slug, saleId, dueCents, test }: { slug: string; saleId: string; dueCents: number; test: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [step, setStep] = useState<Step>("idle");
  const [readers, setReaders] = useState<Reader[]>([]);
  const [error, setError] = useState<string | null>(null);
  const terminal = useRef<Terminal | null>(null);

  async function sdk(): Promise<Terminal> {
    if (terminal.current) return terminal.current;
    const loaded = await loadStripeTerminal();
    if (!loaded) throw new Error("The card reader library could not load.");
    const t = loaded.create({
      onFetchConnectionToken: async () => {
        const r = await terminalToken({ slug, saleId });
        if ("error" in r) throw new Error(r.error);
        return r.secret;
      },
      onUnexpectedReaderDisconnect: () => setError("The reader disconnected. Check its power and network, then try again."),
    });
    terminal.current = t;
    return t;
  }

  async function findReaders() {
    setError(null);
    setStep("connecting");
    try {
      const t = await sdk();
      let list: Reader[];
      if (test) {
        const r = await t.discoverReaders({ simulated: true });
        if ("error" in r) throw new Error(r.error.message);
        list = r.discoveredReaders;
      } else {
        const loc = await terminalLocation({ slug, saleId });
        if ("error" in loc) throw new Error(loc.error);
        const r = await t.discoverReaders({ location: loc.locationId });
        if ("error" in r) throw new Error(r.error.message);
        list = r.discoveredReaders;
      }
      if (!list.length) throw new Error(test ? "No simulated reader found." : "No reader found at this location. Register it in the Stripe Dashboard under Terminal → Readers, power it on and connect it to the network.");
      setReaders(list);
      if (list.length === 1) await pay(list[0]!);
      else setStep("pick");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the card reader.");
      setStep("idle");
    }
  }

  async function pay(reader: Reader) {
    setError(null);
    try {
      const t = await sdk();
      if (!t.getConnectedReader() || t.getConnectedReader()?.id !== reader.id) {
        const c = await t.connectReader(reader);
        if ("error" in c) throw new Error(c.error.message);
      }
      const started = await startTerminalPayment({ slug, saleId, amount });
      if ("error" in started) throw new Error(started.error);
      setStep("waiting");
      const collected = await t.collectPaymentMethod(started.clientSecret);
      if ("error" in collected) throw new Error(collected.error.message);
      setStep("processing");
      const processed = await t.processPayment(collected.paymentIntent);
      if ("error" in processed) throw new Error(processed.error.message);
      const done = await finishCardPayment({ slug, saleId, paymentIntentId: processed.paymentIntent.id });
      if (done?.error) throw new Error(done.error);
      setStep("idle");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The payment did not go through.");
      setStep(readers.length > 1 ? "pick" : "idle");
    }
  }

  async function cancel() {
    try {
      await terminal.current?.cancelCollectPaymentMethod();
    } catch {
      /* nothing to cancel */
    }
    setStep(readers.length > 1 ? "pick" : "idle");
  }

  return (
    <div className="space-y-3">
      {step === "idle" || step === "connecting" ? (
        <>
          <Field label="Amount to charge"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
          {error ? <Notice>{error}</Notice> : null}
          <Button type="button" onClick={findReaders} disabled={step === "connecting"}>{step === "connecting" ? "Finding reader…" : test ? "Use simulated reader" : "Use card reader"}</Button>
        </>
      ) : null}
      {step === "pick" ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">Which reader?</p>
          {readers.map((r) => (
            <Button key={r.id} type="button" variant="secondary" className="w-full justify-start" onClick={() => pay(r)}>{r.label || r.serial_number || r.id}{r.status === "offline" ? " (offline)" : ""}</Button>
          ))}
          {error ? <Notice>{error}</Notice> : null}
        </div>
      ) : null}
      {step === "waiting" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Ask the client to tap, insert or swipe their card on the reader.</p>
          <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
        </div>
      ) : null}
      {step === "processing" ? <p className="text-sm text-stone-600">Processing…</p> : null}
    </div>
  );
}
