"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, MoneyInput, Notice, Select } from "@/components/ui";
import { cancelHelcimTerminal, helcimTerminalStatus, startHelcimTerminal } from "./actions";

/**
 * Take a card on a Helcim Smart Terminal. "Send to terminal" pushes the amount (tip included) to the chosen terminal through Helcim;
 * the client taps or dips there, and this screen watches for the result (Helcim's webhook settles it; the poll catches a late webhook).
 */
export function HelcimTerminalPayment({ slug, saleId, dueCents, devices }: { slug: string; saleId: string; dueCents: number; devices: { id: string; name: string }[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);

  // While the terminal waits for the card: ask every two seconds, give up after three minutes.
  useEffect(() => {
    if (!paymentId) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await helcimTerminalStatus({ slug, saleId, paymentId }).catch(() => ({ status: "pending" as const }));
      if (stop) return;
      if (r.status === "paid") { setPaymentId(null); router.refresh(); return; }
      if (r.status === "declined") { setPaymentId(null); setError("The card was declined. Try another card or another way to pay."); return; }
      if (r.status === "cancelled") { setPaymentId(null); setError("Cancelled on the terminal."); return; }
      if (Date.now() - started.current > 180_000) { setPaymentId(null); setError("No answer from the terminal after three minutes. If the client paid, the payment appears here as soon as Helcim reports it."); return; }
      setTimeout(tick, 2000);
    };
    const t = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(t); };
  }, [paymentId, slug, saleId, router]);

  if (!devices.length) {
    return <p className="text-sm text-stone-500">No Helcim terminal is paired for this location. Pair one under Settings → Payments → Card terminals.</p>;
  }

  if (paymentId) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Sent ${amount} to {devices.find((x) => x.id === deviceId)?.name ?? "the terminal"}. Ask the client to tap, insert or swipe their card.</p>
        <p className="flex items-center gap-2 text-xs text-stone-500"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" aria-hidden /> Waiting for the terminal…</p>
        <Button type="button" variant="ghost" size="sm" onClick={async () => { await cancelHelcimTerminal({ slug, saleId, paymentId }); setPaymentId(null); setError("Stopped waiting. Cancel it on the terminal too if it still shows the amount."); }}>Stop waiting</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount to charge"><MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {devices.length > 1 ? (
          <Field label="Terminal"><Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        ) : null}
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <Button
        type="button"
        disabled={busy || !deviceId}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await startHelcimTerminal({ slug, saleId, deviceId, amount });
          setBusy(false);
          if ("error" in r) setError(r.error);
          else { started.current = Date.now(); setPaymentId(r.paymentId); }
        }}
      >
        {busy ? "Sending…" : devices.length > 1 ? "Send to terminal" : `Send to ${devices[0]!.name}`}
      </Button>
    </div>
  );
}
