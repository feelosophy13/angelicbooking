"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button, Field, Input, Notice, Checkbox } from "@/components/ui";
import { finishCardPayment, startCardPayment } from "./actions";

/**
 * New-card payment on the BUSINESS's connected account. The publishable key is
 * the platform's; `stripeAccount` scopes Elements to the connected account so
 * the PaymentIntent created there can be confirmed.
 */
export function CardPayment(props: { slug: string; saleId: string; dueCents: number; publishableKey: string | null; hasClient: boolean }) {
  const [amount, setAmount] = useState((props.dueCents / 100).toFixed(2));
  const [saveCard, setSaveCard] = useState(false);
  const [intent, setIntent] = useState<{ clientSecret: string; accountId: string | null; publishableKey: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stripePromise = useMemo(
    () => ((intent?.publishableKey ?? props.publishableKey) && intent ? loadStripe((intent.publishableKey ?? props.publishableKey)!, intent.accountId ? { stripeAccount: intent.accountId } : undefined) : null),
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
          <Checkbox checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} label="Save this card to the client for next time" />
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await startCardPayment({ slug: props.slug, saleId: props.saleId, amount, saveCard });
              if ("error" in r) setError(r.error);
              else setIntent({ clientSecret: r.clientSecret, accountId: r.accountId, publishableKey: r.publishableKey });
            })
          }
        >
          {pending ? "…" : "Enter card"}
        </Button>
      </div>
    );
  }

  return (
    // The desk takes cards only, so Stripe's plain card field rather than the Payment Element (which also draws Link's bank and buy-now-pay-later offers).
    <Elements stripe={stripePromise}>
      <ConfirmForm slug={props.slug} saleId={props.saleId} clientSecret={intent.clientSecret} onCancel={() => setIntent(null)} />
    </Elements>
  );
}

function ConfirmForm({ slug, saleId, clientSecret, onCancel }: { slug: string; saleId: string; clientSecret: string; onCancel: () => void }) {
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
    const card = elements.getElement(CardElement);
    if (!card) return;
    const { error: err, paymentIntent } = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } });
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
      <div className="rounded-lg border border-stone-300 bg-white px-3 py-3">
        <CardElement options={{ style: { base: { fontSize: "16px", color: "#1c1917", "::placeholder": { color: "#a8a29e" } } } }} />
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!stripe || busy}>{busy ? "Charging…" : "Charge card"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </form>
  );
}
