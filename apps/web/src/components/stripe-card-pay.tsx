"use client";
import { useMemo, useState } from "react";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { CardElement, Elements, ExpressCheckoutElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Notice } from "@/components/ui";

type Billing = { name?: string; email?: string; phone?: string };

/**
 * Card payment on a business's Stripe account (direct charge: Stripe.js is loaded for the connected account), with Apple Pay and Google
 * Pay on top when `wallets` is on and the device offers them, and the card field below as the fallback.
 *
 * Both ways end the same: the browser creates a PaymentMethod, `prepare` hands it to the server (which can look at the card, add a card fee
 * and attach it to the PaymentIntent or SetupIntent), then the intent is confirmed here with that card and `done` takes over. The server
 * created the intent beforehand; `clientSecret` is its secret.
 */
export function StripeCardPay(props: {
  publishableKey: string;
  stripeAccount: string | null;
  clientSecret: string;
  /** payment: charge (or authorize) now; setup: save the card. */
  mode: "payment" | "setup";
  /** The amount the wallet sheet shows (the most the card can be charged). */
  amountCents: number;
  currency: string;
  /** Save the card for later off-session charges (a deposit or a card hold). */
  saveCard?: boolean;
  wallets: boolean;
  billing?: Billing;
  submitLabel: string;
  busyLabel?: string;
  brand?: string;
  footnote?: string;
  /** The server step between the card and the confirm. An error stops the payment. */
  prepare?: (paymentMethodId: string) => Promise<{ error?: string } | void>;
  /** After Stripe confirmed: the intent id and its status. Return an error to show it. */
  done: (intentId: string, status: string) => Promise<string | null | void>;
}) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey, props.stripeAccount ? { stripeAccount: props.stripeAccount } : undefined), [props.publishableKey, props.stripeAccount]);
  // Wallets need the deferred-intent options (amount, currency, cards only so Link and pay-later offers stay out); a plain card field does not.
  const shared = { currency: props.currency.toLowerCase(), paymentMethodCreation: "manual" as const, allowedPaymentMethodTypes: ["card"], ...(props.saveCard || props.mode === "setup" ? { setupFutureUsage: "off_session" as const } : {}) };
  const options: StripeElementsOptions | undefined = !props.wallets ? undefined : props.mode === "payment" ? { mode: "payment", amount: Math.max(50, props.amountCents), ...shared } : { mode: "setup", ...shared };
  return (
    <Elements stripe={stripePromise} options={options}>
      <PayForm {...props} />
    </Elements>
  );
}

function PayForm(props: Parameters<typeof StripeCardPay>[0]) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletsShown, setWalletsShown] = useState(false);

  /** Prepare on the server, confirm with Stripe, then hand over. Returns an error message, or null when it went through. */
  async function pay(paymentMethodId: string): Promise<string | null> {
    if (!stripe) return "The payment form is still loading.";
    const prep = props.prepare ? await props.prepare(paymentMethodId) : undefined;
    if (prep && prep.error) return prep.error;
    if (props.mode === "payment") {
      const r = await stripe.confirmCardPayment(props.clientSecret, { payment_method: paymentMethodId });
      if (r.error) return r.error.message ?? "Your card was declined.";
      const status = r.paymentIntent?.status ?? "incomplete";
      if (status !== "succeeded" && status !== "requires_capture") return `Payment ${status.replace(/_/g, " ")}. Please try again.`;
      return (await props.done(r.paymentIntent!.id, status)) || null;
    }
    const r = await stripe.confirmCardSetup(props.clientSecret, { payment_method: paymentMethodId });
    if (r.error) return r.error.message ?? "Your card could not be saved.";
    const status = r.setupIntent?.status ?? "incomplete";
    if (status !== "succeeded") return `Your card could not be saved (${status.replace(/_/g, " ")}). Please try again.`;
    return (await props.done(r.setupIntent!.id, status)) || null;
  }

  async function submitCard(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    const created = await stripe.createPaymentMethod({ type: "card", card, billing_details: props.billing });
    const err = created.error ? (created.error.message ?? "Check the card details.") : await pay(created.paymentMethod.id).catch((x: unknown) => (x instanceof Error ? x.message : "The payment did not go through."));
    if (err) {
      setError(err);
      setBusy(false);
    }
    // On success `done` moves the page on; the button stays busy until it does.
  }

  async function confirmWallet(event: { paymentFailed: (p?: { reason?: "fail"; message?: string }) => void; billingDetails?: { name?: string; email?: string; phone?: string } }) {
    if (!stripe || !elements) return;
    setError(null);
    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "The payment did not go through.");
      event.paymentFailed({ reason: "fail" });
      return;
    }
    const created = await stripe.createPaymentMethod({ elements, params: { billing_details: { ...props.billing, ...(event.billingDetails?.name ? { name: event.billingDetails.name } : {}) } } });
    const err = created.error ? (created.error.message ?? "The payment did not go through.") : await pay(created.paymentMethod.id).catch((x: unknown) => (x instanceof Error ? x.message : "The payment did not go through."));
    if (err) {
      setError(err);
      event.paymentFailed({ reason: "fail", message: err });
    }
  }

  return (
    <div className="space-y-3">
      {props.wallets ? (
        <>
          <ExpressCheckoutElement
            options={{ paymentMethods: { applePay: "auto", googlePay: "auto", link: "never", paypal: "never", amazonPay: "never", klarna: "never" }, buttonHeight: 44, buttonType: { applePay: props.mode === "setup" ? "plain" : "book", googlePay: props.mode === "setup" ? "plain" : "book" } }}
            onReady={(e) => setWalletsShown(!!e.availablePaymentMethods && (e.availablePaymentMethods.applePay || e.availablePaymentMethods.googlePay))}
            onConfirm={(e) => void confirmWallet(e)}
          />
          {walletsShown ? (
            <p className="flex items-center gap-3 text-xs text-stone-400" aria-hidden>
              <span className="h-px flex-1 bg-stone-200" />or pay with a card<span className="h-px flex-1 bg-stone-200" />
            </p>
          ) : null}
        </>
      ) : null}
      <form onSubmit={submitCard} className="space-y-3">
        <div className="rounded-lg border border-stone-300 bg-white px-3 py-3">
          <CardElement options={{ style: { base: { fontSize: "16px", color: "#1c1917", "::placeholder": { color: "#a8a29e" } } } }} />
        </div>
        {error ? <Notice>{error}</Notice> : null}
        <button type="submit" disabled={!stripe || busy} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-60" style={props.brand ? { background: props.brand } : undefined}>
          {busy ? (props.busyLabel ?? "Confirming…") : props.submitLabel}
        </button>
        {props.footnote ? <p className="text-xs text-stone-500">{props.footnote}</p> : null}
      </form>
    </div>
  );
}
