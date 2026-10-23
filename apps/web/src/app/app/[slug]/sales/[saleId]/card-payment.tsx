"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice, Checkbox } from "@/components/ui";
import { StripeCardPay } from "@/components/stripe-card-pay";
import { applyDeskCardFee, finishCardPayment, startCardPayment } from "./actions";

/**
 * New-card payment on the BUSINESS's connected account. The publishable key is the platform's; `stripeAccount` scopes Stripe.js to the
 * connected account so the PaymentIntent created there can be confirmed. Card only: the desk types the client's card (a wallet on the
 * desk's own browser would be the desk's, not the client's). With a card fee on, the server looks at the card before it is charged.
 */
export function CardPayment(props: { slug: string; saleId: string; dueCents: number; currency?: string; publishableKey: string | null; hasClient: boolean; feeNotice?: string | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState((props.dueCents / 100).toFixed(2));
  const [saveCard, setSaveCard] = useState(false);
  const [intent, setIntent] = useState<{ clientSecret: string; paymentIntentId: string; accountId: string | null; publishableKey: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
              else setIntent({ clientSecret: r.clientSecret, paymentIntentId: r.paymentIntentId, accountId: r.accountId, publishableKey: r.publishableKey });
            })
          }
        >
          {pending ? "…" : "Enter card"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {props.feeNotice ? <p className="text-xs text-stone-600">{props.feeNotice}</p> : null}
      <StripeCardPay
        publishableKey={(intent.publishableKey ?? props.publishableKey)!}
        stripeAccount={intent.accountId}
        clientSecret={intent.clientSecret}
        mode="payment"
        amountCents={props.dueCents}
        currency={props.currency ?? "usd"}
        wallets={false}
        submitLabel="Charge card"
        busyLabel="Charging…"
        prepare={async (pm) => applyDeskCardFee({ slug: props.slug, saleId: props.saleId, paymentIntentId: intent.paymentIntentId, paymentMethodId: pm })}
        done={async (id) => {
          const r = await finishCardPayment({ slug: props.slug, saleId: props.saleId, paymentIntentId: id });
          router.refresh();
          return r?.error ?? null;
        }}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => setIntent(null)}>Back</Button>
    </div>
  );
}
