"use client";
import { useMemo, useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button, Notice } from "@/components/ui";
import { ContactFields, type BookingDefaults } from "./forms";
import { abandonOnlinePaymentAction, finishOnlineBookingAction, startOnlinePaymentAction } from "./actions";

type Intent = { clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string | null; publishableKey: string | null };

/**
 * Booking form for services that take a deposit or require a card on file.
 * Details are collected first; the card is entered on the business's own
 * Stripe account; the appointment is created only after Stripe confirms.
 */
export function PaidBookingForm(props: {
  /** The full price of the visit, shown above the button. */
  priceLabel?: string;
  /** More services in this visit, same provider, booked back to back. */
  extraServiceIds?: string[];
  slug: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  policy: string | null;
  cancelWindowHours: number;
  /** What the page quoted for this stylist, in cents; the server refuses the booking if it has since changed. */
  quotedPriceCents?: number;
  lateFee?: string | null;
  mode: "deposit" | "card";
  /** The up-front payment is the whole price, not a deposit. */
  full?: boolean;
  amountLabel: string;
  publishableKey: string;
  brand: string;
  classSessionId?: string | null;
  referrals?: boolean;
  defaults?: BookingDefaults;
  promos?: boolean;
  locationId?: string | null;
  embed?: boolean;
}) {
  const d = props.defaults;
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stripePromise = useMemo(() => (intent ? loadStripe(intent.publishableKey ?? props.publishableKey, intent.accountId ? { stripeAccount: intent.accountId } : undefined) : null), [props.publishableKey, intent]);

  if (!intent || !fields) {
    return (
      <form
        className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const raw: Record<string, string> = {};
          for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
          start(async () => {
            setError(null);
            const r = await startOnlinePaymentAction(raw);
            if ("error" in r) setError(r.error);
            else {
              setFields(raw);
              setIntent(r);
            }
          });
        }}
      >
        <input type="hidden" name="slug" value={props.slug} />
        {props.embed ? <input type="hidden" name="embed" value="1" /> : null}
        <input type="hidden" name="serviceId" value={props.serviceId} />
        <input type="hidden" name="staffId" value={props.staffId} />
        <input type="hidden" name="startAt" value={props.startAt} />
        {props.extraServiceIds?.length ? <input type="hidden" name="extraServiceIds" value={props.extraServiceIds.join(",")} /> : null}
      {props.quotedPriceCents !== undefined ? <input type="hidden" name="quotedPriceCents" value={props.quotedPriceCents} /> : null}
        {props.classSessionId ? <input type="hidden" name="classSessionId" value={props.classSessionId} /> : null}
        {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Step 1 of 2 · Your details</p>
        <ContactFields defaults={d} referrals={props.referrals} promos={props.promos} />
        {error ? <Notice>{error}</Notice> : null}
        {props.priceLabel ? <p className="text-sm font-medium text-stone-800">Price of this visit: {props.priceLabel}</p> : null}
        <Button type="submit" disabled={pending} className="w-full" style={{ background: props.brand }}>
          {pending ? "One moment…" : props.mode === "deposit" ? props.full ? `Continue to pay ${props.amountLabel}` : `Continue to pay ${props.amountLabel} deposit` : "Continue to add a card"}
        </Button>
        <p className="text-xs text-stone-500">
          {props.mode === "deposit" ? props.full ? `${props.amountLabel} is charged now, paying for your visit in full.` : `A ${props.amountLabel} deposit is charged now and comes off your bill on the day.` : "Your card is saved to hold the booking. Nothing is charged now."} You can cancel or reschedule online up to {props.cancelWindowHours} hours before.{props.lateFee ? ` Cancellations inside that window carry a fee of ${props.lateFee}.` : ""}{props.policy ? ` ${props.policy}` : ""}
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Step 2 of 2 · {props.mode === "deposit" ? "Payment" : "Card"}</p>
      <p className="text-sm">
        <span className="font-medium">{fields.firstName} {fields.lastName}</span> · {fields.phone || fields.email}{" "}
        <button type="button" className="underline" onClick={() => { void abandonOnlinePaymentAction(props.slug, props.locationId ?? null, { kind: intent.kind, id: intent.intentId }); setIntent(null); }}>Edit</button>
      </p>
      <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: props.brand } } }}>
        <ConfirmStep fields={fields} intent={intent} mode={props.mode} amountLabel={props.amountLabel} brand={props.brand} />
      </Elements>
    </div>
  );
}

function ConfirmStep({ fields, intent, mode, amountLabel, brand }: { fields: Record<string, string>; intent: Intent; mode: "deposit" | "card"; amountLabel: string; brand: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const r = mode === "deposit" ? await stripe.confirmPayment({ elements, redirect: "if_required" }) : await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (r.error) {
      setError(r.error.message ?? "Your card was declined.");
      setBusy(false);
      return;
    }
    const status = mode === "deposit" ? (r as { paymentIntent?: { status: string } }).paymentIntent?.status : (r as { setupIntent?: { status: string } }).setupIntent?.status;
    if (status !== "succeeded") {
      setError(`Payment ${status ?? "incomplete"}. Please try again.`);
      setBusy(false);
      return;
    }
    const out = await finishOnlineBookingAction(fields, { kind: intent.kind, id: intent.intentId });
    if (out?.error) {
      setError(out.error);
      setBusy(false);
    }
    // On success the action redirects to the confirmation page.
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <Notice>{error}</Notice> : null}
      <Button type="submit" disabled={!stripe || busy} className="w-full" style={{ background: brand }}>
        {busy ? "Confirming…" : mode === "deposit" ? `Pay ${amountLabel} and book` : "Save card and book"}
      </Button>
      <p className="text-xs text-stone-500">Payments are processed by Stripe. Your card details never touch our servers.</p>
    </form>
  );
}
