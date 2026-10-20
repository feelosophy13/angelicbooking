"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field, MoneyInput, Notice } from "@/components/ui";
import { abandonHelcimCard, finishHelcimCard, startHelcimCard } from "./actions";
import { openHelcimPay } from "@/lib/helcim-pay";

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
            const r = await startHelcimCard({ slug, saleId, amount, saveCard: hasClient && saveCard });
            if ("error" in r) { setError(r.error); setBusy(false); return; }
            const out = await openHelcimPay(r.checkoutToken, () => setError("The card was declined. Try another card."));
            if (out.status === "SUCCESS") {
              const done = await finishHelcimCard({ slug, saleId, paymentId: r.paymentId, eventMessage: out.message });
              if (done?.error) setError(done.error);
              else router.refresh();
            } else {
              await abandonHelcimCard({ slug, saleId, paymentId: r.paymentId });
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't open the card form.");
          }
          setBusy(false);
        }}
      >
        {busy ? "Card form open…" : "Enter card"}
      </Button>
    </div>
  );
}
