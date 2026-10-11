"use client";
import { useMemo, useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Field, Input, Notice, Textarea } from "@/components/ui";
import { SmsConsent, type BookingDefaults } from "./forms";
import { finishOnlineBookingAction, startOnlinePaymentAction } from "./actions";

type Intent = { clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string };

/**
 * Booking form for services that take a deposit or require a card on file.
 * Details are collected first; the card is entered on the business's own
 * Stripe account; the appointment is created only after Stripe confirms.
 */
export function PaidBookingForm(props: {
  slug: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  policy: string | null;
  cancelWindowHours: number;
  mode: "deposit" | "card";
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
  const stripePromise = useMemo(() => (intent ? loadStripe(props.publishableKey, { stripeAccount: intent.accountId }) : null), [props.publishableKey, intent]);

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
        {props.classSessionId ? <input type="hidden" name="classSessionId" value={props.classSessionId} /> : null}
        {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
        {d ? <p className="text-sm text-stone-600">Booking as <b>{d.firstName} {d.lastName}</b>.</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input name="firstName" required autoComplete="given-name" defaultValue={d?.firstName} /></Field>
          <Field label="Last name"><Input name="lastName" autoComplete="family-name" defaultValue={d?.lastName} /></Field>
        </div>
        <Field label="Mobile number"><Input name="phone" type="tel" autoComplete="tel" defaultValue={d?.phone ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" defaultValue={d?.email ?? ""} /></Field>
        {d?.smsOptIn ? <input type="hidden" name="smsConsent" value="on" /> : <SmsConsent />}
        <Field label="Anything we should know?"><Textarea name="notes" rows={4} /></Field>
        {props.referrals && !d ? <Field label="Referral code (optional)"><Input name="referralCode" placeholder="From a friend who comes here" className="uppercase" /></Field> : null}
      {props.promos ? <Field label="Promo code (optional)"><Input name="promoCode" placeholder="Code" className="uppercase" /></Field> : null}
        {error ? <Notice>{error}</Notice> : null}
        <button type="submit" disabled={pending} className="inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60" style={{ background: props.brand }}>
          {pending ? "One moment…" : props.mode === "deposit" ? `Continue to pay ${props.amountLabel} deposit` : "Continue to add a card"}
        </button>
        <p className="text-xs text-stone-500">
          {props.mode === "deposit" ? `A ${props.amountLabel} deposit is charged now and comes off your bill on the day.` : "Your card is saved to hold the booking. Nothing is charged now."} You can cancel or reschedule online up to {props.cancelWindowHours} hours before.{props.policy ? ` ${props.policy}` : ""}
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-sm">
        <span className="font-medium">{fields.firstName} {fields.lastName}</span> · {fields.phone || fields.email}{" "}
        <button type="button" className="underline" onClick={() => setIntent(null)}>Edit</button>
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
      <button type="submit" disabled={!stripe || busy} className="inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60" style={{ background: brand }}>
        {busy ? "Confirming…" : mode === "deposit" ? `Pay ${amountLabel} and book` : "Save card and book"}
      </button>
      <p className="text-xs text-stone-500">Payments are processed by Stripe. Your card details never touch our servers.</p>
    </form>
  );
}
