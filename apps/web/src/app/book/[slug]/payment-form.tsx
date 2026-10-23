"use client";
import { PublicBotCheck } from "@/components/turnstile";
import { useRef, useState, useTransition } from "react";
import { Button, Notice } from "@/components/ui";
import { StripeCardPay } from "@/components/stripe-card-pay";
import type { CardFeeQuote } from "@/lib/card-fee";
import { ContactFields, type BookingDefaults } from "./forms";
import { useHydrated } from "@/lib/use-hydrated";
import { policyLine } from "@/lib/policy-text";
import { abandonOnlinePaymentAction, applyDepositFeeAction, finishOnlineBookingAction, startOnlinePaymentAction } from "./actions";
import { PHOTOS_FIELD } from "@/lib/booking-photos";
import { openHelcimPay } from "@/lib/helcim-pay";
import { useBookingVerification } from "./verify-contact";

type Intent =
  | { provider: "stripe"; clientSecret: string; intentId: string; kind: "deposit" | "card"; accountId: string | null; publishableKey: string | null }
  | { provider: "helcim"; checkoutToken: string; intentId: string; kind: "deposit" | "card" };

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
  /** The up-front payment in cents (the deposit, before any card fee). */
  amountCents?: number;
  /** A card fee on the deposit (Settings → Checkout & tips), shown before paying. */
  cardFee?: CardFeeQuote | null;
  currency?: string;
  publishableKey: string;
  brand: string;
  classSessionId?: string | null;
  referrals?: boolean;
  defaults?: BookingDefaults;
  promos?: boolean;
  locationId?: string | null;
  embed?: boolean;
  /** The business lets clients attach pictures (Settings → Online booking). */
  photos?: boolean;
  /** Ask for a booking code before the card step (Settings → Booking rules; not for a signed-in client). */
  verify?: boolean;
}) {
  const d = props.defaults;
  const hydrated = useHydrated();
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  // The pictures chosen in step 1 wait here while the card is entered, then go up with the booking.
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Step 1 waits here while the booking code is checked, then carries on with the same details plus the proof.
  const waitingFor = useRef<{ raw: Record<string, string>; files: File[] } | null>(null);
  const begin = (raw: Record<string, string>, files: File[]) =>
    start(async () => {
      setError(null);
      const r = await startOnlinePaymentAction(raw);
      if ("error" in r) setError(r.error);
      else {
        setFields(raw);
        setPhotoFiles(files);
        setIntent(r);
      }
    });
  const v = useBookingVerification(props.slug, !!props.verify, (token) => {
    const w = waitingFor.current;
    waitingFor.current = null;
    if (w) begin({ ...w.raw, verifyToken: token }, w.files);
  }, () => (document.querySelector<HTMLInputElement>('form [name="cf-turnstile-response"]')?.value || null));
  const fee = props.mode === "deposit" ? (props.cardFee ?? null) : null;

  if (!intent || !fields) {
    return (
      <form
        method="post"
        className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const raw: Record<string, string> = {};
          for (const [k, v] of fd.entries()) if (typeof v === "string") raw[k] = v;
          const files = fd.getAll(PHOTOS_FIELD).filter((f): f is File => f instanceof File && f.size > 0);
          if (v.token) raw.verifyToken = v.token;
          if (props.verify && !v.token) {
            waitingFor.current = { raw, files };
            void v.ensure(raw.phone ?? "", raw.email ?? "", raw["cf-turnstile-response"] || null).then((ok) => { if (ok) { waitingFor.current = null; begin(raw, files); } });
            return;
          }
          begin(raw, files);
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
        <ContactFields defaults={d} referrals={props.referrals} promos={props.promos} photos={props.photos} />
        {error ? <Notice>{error}</Notice> : null}
        {v.panel}
        {props.priceLabel ? <p className="text-sm font-medium text-stone-800">Price of this visit: {props.priceLabel}</p> : null}
        {fee ? <p className="text-sm text-stone-700">{fee.notice}</p> : null}
        <PublicBotCheck resetKey={`${error ?? ""}:${v.sends}`} />
        <Button type="submit" disabled={pending || !hydrated || v.busy} className={v.waiting ? "hidden" : "w-full"} style={{ background: props.brand }}>
          {pending ? "One moment…" : props.mode === "deposit" ? props.full ? `Continue to pay ${props.amountLabel}` : `Continue to pay ${props.amountLabel} deposit` : "Continue to add a card"}
        </Button>
        <p className="text-xs text-stone-500">
          {props.mode === "deposit" ? props.full ? `${props.amountLabel} is charged now, paying for your visit in full.` : `A ${props.amountLabel} deposit is charged now and comes off your bill on the day.` : "Your card is saved to hold the booking. Nothing is charged now."} {policyLine(props)} By booking, you agree to this policy.
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Step 2 of 2 · {props.mode === "deposit" ? "Payment" : "Card"}</p>
      <p className="text-sm">
        <span className="font-medium">{fields.firstName} {fields.lastName}</span> · {fields.phone || fields.email}{photoFiles.length ? ` · ${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"}` : ""}{" "}
        <button type="button" className="underline" onClick={() => { void abandonOnlinePaymentAction(props.slug, props.locationId ?? null, { kind: intent.kind, id: intent.intentId }); setIntent(null); }}>Edit</button>
      </p>
      {fee && props.amountCents ? (
        <dl className="space-y-0.5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-stone-500">{props.full ? "Visit" : "Deposit"}</dt><dd>{props.amountLabel}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-stone-500">Card fee{fee.debitExempt ? " (credit cards)" : ""}</dt><dd>{money(fee.estimateCents, props.currency)}</dd></div>
          <div className="flex justify-between gap-4 font-medium"><dt>Total</dt><dd>{money(props.amountCents + fee.estimateCents, props.currency)}</dd></div>
          {fee.debitExempt ? <p className="text-xs text-stone-500">Debit cards pay no fee: {props.amountLabel}.</p> : null}
        </dl>
      ) : null}
      {intent.provider === "helcim" ? (
        <HelcimConfirmStep fields={fields} photos={photoFiles} intent={intent} mode={props.mode} amountLabel={fee && props.amountCents ? money(props.amountCents + fee.estimateCents, props.currency) : props.amountLabel} brand={props.brand} />
      ) : (
        <ConfirmStep fields={fields} photos={photoFiles} intent={intent} mode={props.mode} amountLabel={fee && props.amountCents ? money(props.amountCents + fee.estimateCents, props.currency) : props.amountLabel} brand={props.brand} slug={props.slug} locationId={props.locationId ?? null} publishableKey={props.publishableKey} walletAmountCents={(props.amountCents ?? 0) + (fee?.estimateCents ?? 0)} currency={props.currency ?? "usd"} />
      )}
    </div>
  );
}

/** Helcim: the card goes into Helcim's secure form (HelcimPay.js); its answer is verified on the server before the booking is made. */
function HelcimConfirmStep({ fields, photos, intent, mode, amountLabel, brand }: { fields: Record<string, string>; photos: File[]; intent: Extract<Intent, { provider: "helcim" }>; mode: "deposit" | "card"; amountLabel: string; brand: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const out = await openHelcimPay(intent.checkoutToken, () => setError("Your card was declined. Try another card."));
      if (out.status !== "SUCCESS") { setBusy(false); return; }
      let attached: FormData | null = null;
      if (photos.length) {
        attached = new FormData();
        for (const f of photos) attached.append(PHOTOS_FIELD, f);
      }
      const r = await finishOnlineBookingAction(fields, { kind: intent.kind, id: intent.intentId, helcim: out.message }, attached);
      if (r?.error) { setError(r.error); setBusy(false); }
      // On success the action redirects to the confirmation page.
    } catch (e) {
      setError(e instanceof Error ? e.message : "The card form could not open.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error ? <Notice>{error}</Notice> : null}
      <Button type="button" onClick={pay} disabled={busy} className="w-full" style={{ background: brand }}>
        {busy ? "Confirming…" : mode === "deposit" ? `Pay ${amountLabel} and book` : "Add card and book"}
      </Button>
      <p className="text-xs text-stone-500">Payments are processed by Helcim. Your card details never touch our servers.</p>
    </div>
  );
}

/** Stripe: Apple Pay or Google Pay when the device has them, else the card field. The card fee (if any) is settled on the server before the confirm. */
function ConfirmStep({ fields, photos, intent, mode, amountLabel, brand, slug, locationId, publishableKey, walletAmountCents, currency }: { fields: Record<string, string>; photos: File[]; intent: Extract<Intent, { provider: "stripe" }>; mode: "deposit" | "card"; amountLabel: string; brand: string; slug: string; locationId: string | null; publishableKey: string; walletAmountCents: number; currency: string }) {
  const billing = { name: `${fields.firstName ?? ""} ${fields.lastName ?? ""}`.trim() || undefined, email: fields.email || undefined, phone: fields.phone || undefined };
  return (
    <StripeCardPay
      publishableKey={intent.publishableKey ?? publishableKey}
      stripeAccount={intent.accountId}
      clientSecret={intent.clientSecret}
      mode={mode === "deposit" ? "payment" : "setup"}
      amountCents={walletAmountCents}
      currency={currency}
      saveCard
      wallets
      billing={billing}
      brand={brand}
      submitLabel={mode === "deposit" ? `Pay ${amountLabel} and book` : "Save card and book"}
      footnote="Payments are processed by Stripe. Your card details never touch our servers."
      prepare={mode === "deposit" ? async (pm) => { const r = await applyDepositFeeAction(slug, locationId, intent.intentId, pm); return "error" in r ? { error: r.error } : undefined; } : undefined}
      done={async () => {
        let attached: FormData | null = null;
        if (photos.length) {
          attached = new FormData();
          for (const f of photos) attached.append(PHOTOS_FIELD, f);
        }
        const out = await finishOnlineBookingAction(fields, { kind: intent.kind, id: intent.intentId }, attached);
        // On success the action redirects to the confirmation page.
        return out?.error ?? null;
      }}
    />
  );
}

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
