"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { parseMoney } from "@angelic/core";
import { Input, Notice, Radio, RadioGroup } from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { openHelcimPay } from "@/lib/helcim-pay";
import { finishInvoicePaymentAction, startInvoicePaymentAction } from "./actions";
import type { StartPaymentResult } from "@/server/invoices";

/**
 * Pay an invoice: the deposit asked for (when there is one still due), the whole balance, or another amount in between. The card goes
 * into Stripe's field (on the salon's own account) or Helcim's secure form; the server confirms it before the invoice shows as paid.
 */
export function InvoicePay(props: { slug: string; token: string; currency: string; brand: string; balanceCents: number; depositDueCents: number | null; minCents: number; publishableKey: string; name: string; email: string }) {
  const money = (c: number) => formatMoney(c, props.currency);
  const [picked, setChoice] = useState<"deposit" | "full" | "other">(props.depositDueCents ? "deposit" : "full");
  // After a deposit is paid the page reloads with none due: the choice falls back to the balance.
  const choice = picked === "deposit" && !props.depositDueCents ? "full" : picked;
  const [paid, setPaid] = useState<string | null>(null);
  const router = useRouter();
  const onPaid = (cents: number) => {
    setIntent(null);
    setPaid(`Thank you! Your payment of ${money(cents)} went through.`);
    router.refresh();
  };
  const [other, setOther] = useState("");
  const [intent, setIntent] = useState<StartPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const amount = choice === "deposit" ? props.depositDueCents! : choice === "full" ? props.balanceCents : (parseMoney(other) ?? 0);
  const stripePromise = useMemo(() => (intent?.provider === "stripe" ? loadStripe(intent.publishableKey ?? props.publishableKey, intent.accountId ? { stripeAccount: intent.accountId } : undefined) : null), [intent, props.publishableKey]);
  const btn = "inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60";

  if (intent) {
    return (
      <div className="space-y-3">
        <p className="text-sm">Paying <b>{money(intent.amountCents)}</b> · <button type="button" className="underline" onClick={() => setIntent(null)}>Change</button></p>
        {intent.provider === "stripe" ? (
          <Elements stripe={stripePromise}>
            <StripeCard {...props} intent={intent} btn={btn} onPaid={onPaid} />
          </Elements>
        ) : (
          <HelcimCard {...props} intent={intent} btn={btn} onPaid={onPaid} />
        )}
      </div>
    );
  }
  const showOther = props.balanceCents > props.minCents && props.balanceCents > 100;
  return (
    <div className="space-y-3">
      {paid ? <Notice kind="success">{paid}</Notice> : null}
      <RadioGroup>
        {props.depositDueCents ? <Radio name="amount" checked={choice === "deposit"} onChange={() => setChoice("deposit")} label={`Pay the deposit: ${money(props.depositDueCents)}`} hint="Pay the rest later from this same page." /> : null}
        <Radio name="amount" checked={choice === "full"} onChange={() => setChoice("full")} label={`Pay in full: ${money(props.balanceCents)}`} />
        {showOther ? <Radio name="amount" checked={choice === "other"} onChange={() => setChoice("other")} label="Pay another amount" /> : null}
      </RadioGroup>
      {choice === "other" ? (
        <div>
          <Input inputMode="decimal" placeholder={`${(Math.max(props.minCents, 50) / 100).toFixed(2)} to ${(props.balanceCents / 100).toFixed(2)}`} value={other} onChange={(e) => setOther(e.target.value)} aria-label="Amount to pay" />
        </div>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}
      <button
        type="button"
        disabled={pending || amount <= 0}
        className={btn}
        style={{ background: props.brand }}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startInvoicePaymentAction(props.slug, props.token, amount);
            if ("error" in r) setError(r.error);
            else setIntent(r);
          })
        }
      >
        {pending ? "One moment…" : `Continue to pay ${amount > 0 ? money(amount) : ""}`}
      </button>
    </div>
  );
}

type CardProps = { slug: string; token: string; currency: string; brand: string; name: string; email: string; btn: string; onPaid: (cents: number) => void };

function StripeCard({ intent, ...p }: CardProps & { intent: Extract<StartPaymentResult, { provider: "stripe" }> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const card = elements?.getElement(CardElement);
    if (!stripe || !card) return;
    setBusy(true);
    setError(null);
    const r = await stripe.confirmCardPayment(intent.clientSecret, { payment_method: { card, billing_details: { name: p.name || undefined, email: p.email || undefined } } });
    if (r.error || r.paymentIntent?.status !== "succeeded") {
      setError(r.error?.message ?? `Payment ${r.paymentIntent?.status ?? "incomplete"}.`);
      setBusy(false);
      return;
    }
    const out = await finishInvoicePaymentAction(p.slug, p.token, r.paymentIntent.id);
    if (out.error) {
      setError(out.error);
      setBusy(false);
      return;
    }
    p.onPaid(intent.amountCents);
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-lg border border-stone-300 bg-white px-3 py-3">
        <CardElement options={{ style: { base: { fontSize: "16px", color: "#1c1917", "::placeholder": { color: "#a8a29e" } } } }} />
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <button type="submit" disabled={!stripe || busy} className={p.btn} style={{ background: p.brand }}>{busy ? "Paying…" : `Pay ${formatMoney(intent.amountCents, p.currency)}`}</button>
    </form>
  );
}

function HelcimCard({ intent, ...p }: CardProps & { intent: Extract<StartPaymentResult, { provider: "helcim" }> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await openHelcimPay(intent.checkoutToken, () => setError("Your card was declined. Try another card."));
      if (r.status !== "SUCCESS") { setBusy(false); return; }
      const out = await finishInvoicePaymentAction(p.slug, p.token, intent.intentId, r.message);
      if (out.error) { setError(out.error); setBusy(false); return; }
      p.onPaid(intent.amountCents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The card form could not open.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error ? <Notice>{error}</Notice> : null}
      <button type="button" onClick={pay} disabled={busy} className={p.btn} style={{ background: p.brand }}>{busy ? "Paying…" : `Pay ${formatMoney(intent.amountCents, p.currency)}`}</button>
      <p className="text-xs text-stone-500">Payments are processed by Helcim. Your card details never touch our servers.</p>
    </div>
  );
}
