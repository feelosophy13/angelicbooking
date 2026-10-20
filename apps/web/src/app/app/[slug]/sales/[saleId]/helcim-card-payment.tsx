"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field, MoneyInput, Notice } from "@/components/ui";
import { abandonHelcimCard, finishHelcimCard, startHelcimCard } from "./actions";

declare global {
  interface Window {
    appendHelcimPayIframe?: (checkoutToken: string, allowExit?: boolean) => void;
    removeHelcimPayIframe?: () => void;
  }
}

let scriptLoading: Promise<void> | null = null;
function loadHelcimPay(): Promise<void> {
  if (window.appendHelcimPayIframe) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://secure.helcim.app/helcim-pay/services/start.js";
    el.onload = () => resolve();
    el.onerror = () => { scriptLoading = null; reject(new Error("Helcim's card form could not load. Check the connection and try again.")); };
    document.head.appendChild(el);
  });
  return scriptLoading;
}

/**
 * A card typed in at the desk, through HelcimPay.js: the card number goes straight into Helcim's secure form (never to our server).
 * The result is checked on the server against the secret kept for this payment, then confirmed with Helcim before the ticket is paid.
 */
export function HelcimCardPayment({ slug, saleId, dueCents, hasClient }: { slug: string; saleId: string; dueCents: number; hasClient: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [saveCard, setSaveCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ paymentId: string; checkoutToken: string } | null>(null);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const s = session.current;
      const data = event.data as { eventName?: string; eventStatus?: string; eventMessage?: unknown } | null;
      if (!s || !data || data.eventName !== `helcim-pay-js-${s.checkoutToken}`) return;
      if (data.eventStatus === "SUCCESS") {
        session.current = null;
        window.removeHelcimPayIframe?.();
        setBusy(true);
        const r = await finishHelcimCard({ slug, saleId, paymentId: s.paymentId, eventMessage: data.eventMessage });
        setBusy(false);
        if (r?.error) setError(r.error);
        else router.refresh();
      } else if (data.eventStatus === "ABORTED") {
        setError("The card was declined. Try another card.");
      } else if (data.eventStatus === "HIDE") {
        session.current = null;
        await abandonHelcimCard({ slug, saleId, paymentId: s.paymentId });
        setBusy(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [slug, saleId, router]);

  return (
    <div className="space-y-3">
      <Field label="Amount to charge"><MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      {hasClient ? <Checkbox checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} label="The client agrees to save this card for future charges (needed for late-cancel or no-show fees)" /> : null}
      {error ? <Notice>{error}</Notice> : null}
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await loadHelcimPay();
            const r = await startHelcimCard({ slug, saleId, amount, saveCard: hasClient && saveCard });
            if ("error" in r) { setError(r.error); setBusy(false); return; }
            session.current = r;
            window.appendHelcimPayIframe?.(r.checkoutToken, true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't open the card form.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Card form open…" : "Enter card"}
      </Button>
    </div>
  );
}
