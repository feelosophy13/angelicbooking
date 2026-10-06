"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button, Field, Input, Notice } from "@/components/ui";
import { finishCardPayment, startCardPayment } from "./actions";

/**
 * New-card payment on the BUSINESS's connected account. The publishable key is
 * the platform's; `stripeAccount` scopes Elements to the connected account so
 * the PaymentIntent created there can be confirmed.
 */
export function CardPayment(props: { slug: string; saleId: string; dueCents: number; publishableKey: string | null; hasClient: boolean }) {
  const [amount, setAmount] = useState((props.dueCents / 100).toFixed(2));
  const [saveCard, setSaveCard] = useState(false);
  const [intent, setIntent] = useState<{ clientSecret: string; accountId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stripePromise = useMemo(
    () => (props.publishableKey && intent ? loadStripe(props.publishableKey, { stripeAccount: intent.accountId }) : null),
    [props.publishableKey, intent],
  );

  if (!props.publishableKey) {
    return <p className="text-sm text-stone-500">Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to accept cards in the browser.</p>;
  }

  if (!intent) {
    return (
      <div className="space-y-3">
        <Field label="Amount to charge"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
        {props.hasClient ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Save this card to the client for next time
          </label>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await startCardPayment({ slug: props.slug, saleId: props.saleId, amount, saveCard });
              if ("error" in r) setError(r.error);
              else setIntent({ clientSecret: r.clientSecret, accountId: r.accountId });
            })
          }
        >
          {pending ? "…" : "Enter card"}
        </Button>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret, appearance: { theme: "stripe" } }}>
      <ConfirmForm slug={props.slug} saleId={props.saleId} onCancel={() => setIntent(null)} />
    </Elements>
  );
}

function ConfirmForm({ slug, saleId, onCancel }: { slug: string; saleId: string; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (err) {
      setError(err.message ?? "Payment failed");
      setBusy(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      const r = await finishCardPayment({ slug, saleId, paymentIntentId: paymentIntent.id });
      if (r?.error) setError(r.error);
      router.refresh();
    } else {
      setError(`Payment ${paymentIntent?.status ?? "incomplete"}`);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement />
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!stripe || busy}>{busy ? "Charging…" : "Charge card"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </form>
  );
}
