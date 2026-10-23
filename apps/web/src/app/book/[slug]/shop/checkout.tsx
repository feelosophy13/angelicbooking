"use client";
import { PublicBotCheck } from "@/components/turnstile";
import { useHydrated } from "@/lib/use-hydrated";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox, Field, Input, Notice, Radio, RadioGroup, Textarea } from "@/components/ui";
import { StripeCardPay } from "@/components/stripe-card-pay";
import { applyOrderFeeAction, finishOrderAction, startOrderAction, type StartOrderResult } from "./actions";
import { openHelcimPay } from "@/lib/helcim-pay";

export type CartProduct = { id: string; name: string; groupId?: string | null; groupName?: string | null; optionLabel?: string | null; priceCents: number; description: string | null; imageUrl: string | null; category: string | null; stockQty: number; trackStock: boolean };
type Started = Exclude<StartOrderResult, { error: string }>;

function money(c: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(c / 100);
}

/**
 * Store cart + checkout, or a single gift card purchase. Payment goes to the
 * business's own Stripe account; the order is created before payment and
 * closed once Stripe confirms.
 */
export function StoreCheckout(props: { slug: string; currency: string; products: CartProduct[]; shippingFlatCents: number; publishableKey: string; brand: string; gift?: { presets: number[] } | null; defaults?: { firstName: string; lastName: string; email: string | null; phone: string | null } | null; locationId?: string | null }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [giftAmount, setGiftAmount] = useState<number>(props.gift?.presets[1] ?? 5000);
  const [giftCustom, setGiftCustom] = useState("");
  const [gift, setGift] = useState({ recipientName: "", recipientEmail: "", message: "" });
  const [forSomeone, setForSomeone] = useState(false);
  const [method, setMethod] = useState<"pickup" | "ship">("pickup");
  const [address, setAddress] = useState("");
  const [buyer, setBuyer] = useState({ firstName: props.defaults?.firstName ?? "", lastName: props.defaults?.lastName ?? "", email: props.defaults?.email ?? "", phone: props.defaults?.phone ?? "" });
  const hydrated = useHydrated();
  const router = useRouter();
  const [started, setStarted] = useState<Started | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isGift = !!props.gift;
  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([productId, quantity]) => ({ productId, quantity }));
  const giftCents = isGift ? (giftCustom ? Math.round(Number(giftCustom) * 100) : giftAmount) : 0;
  const subtotal = items.reduce((s, i) => s + (props.products.find((p) => p.id === i.productId)?.priceCents ?? 0) * i.quantity, 0) + (isGift ? giftCents || 0 : 0);
  const shipping = method === "ship" ? props.shippingFlatCents : 0;
  const canShip = props.shippingFlatCents > 0 && !isGift;
  // A product with options is one entry with its options under it; anything else stands alone.
  const shelf = useMemo(() => {
    const out: ({ kind: "single"; p: CartProduct } | { kind: "group"; id: string; name: string; first: CartProduct; options: CartProduct[] })[] = [];
    const at = new Map<string, number>();
    for (const p of props.products) {
      if (!p.groupId) {
        out.push({ kind: "single", p });
        continue;
      }
      const i = at.get(p.groupId);
      if (i === undefined) {
        at.set(p.groupId, out.length);
        out.push({ kind: "group", id: p.groupId, name: p.groupName ?? p.name, first: p, options: [p] });
      } else (out[i] as { options: CartProduct[] }).options.push(p);
    }
    return out;
  }, [props.products]);
  const stockNote = (p: CartProduct) => (p.trackStock && p.stockQty <= 0 ? <span className="ml-2 text-xs text-red-600">Sold out</span> : p.trackStock && p.stockQty <= 3 ? <span className="ml-2 text-xs text-amber-700">Only {p.stockQty} left</span> : null);
  const Stepper = ({ p }: { p: CartProduct }) => {
    const n = qty[p.id] ?? 0;
    if (p.trackStock && p.stockQty <= 0) return null;
    return (
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`Less ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: Math.max(0, n - 1) })} className="h-8 w-8 rounded-lg border border-stone-300 bg-white">−</button>
        <span className="w-6 text-center text-sm">{n}</span>
        <button type="button" aria-label={`More ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: Math.min(p.trackStock ? p.stockQty : 20, n + 1) })} className="h-8 w-8 rounded-lg border border-stone-300 bg-white">+</button>
      </div>
    );
  };

  // A product with options: one card, a dropdown to choose the option, and its price, photo and quantity below it. Options already in the cart are listed so they can be changed.
  const [pick, setPick] = useState<Record<string, string>>({});
  const GroupCard = ({ entry }: { entry: { id: string; name: string; first: CartProduct; options: CartProduct[] } }) => {
    const soldOut = (o: CartProduct) => o.trackStock && o.stockQty <= 0;
    const chosen = entry.options.find((o) => o.id === pick[entry.id]) ?? entry.options.find((o) => !soldOut(o)) ?? entry.options[0]!;
    const image = chosen.imageUrl ?? entry.first.imageUrl;
    const inCart = entry.options.filter((o) => (qty[o.id] ?? 0) > 0);
    return (
      <li className="px-4 py-3">
        <div className="flex items-start gap-3">
          {image ? <img src={image} alt="" className="h-20 w-20 rounded-lg border border-stone-200 object-cover" /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{entry.name}</p>
            {entry.first.description ? <p className="text-xs text-stone-500">{entry.first.description}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                aria-label={`Choose an option of ${entry.name}`}
                value={chosen.id}
                onChange={(e) => setPick({ ...pick, [entry.id]: e.target.value })}
                className="h-9 max-w-full rounded-lg border border-stone-300 bg-white px-2 text-sm"
              >
                {entry.options.map((o) => (
                  <option key={o.id} value={o.id} disabled={soldOut(o) && o.id !== chosen.id}>{o.optionLabel}{soldOut(o) ? " · sold out" : ""}</option>
                ))}
              </select>
              <span className="text-sm font-medium">{money(chosen.priceCents, props.currency)}</span>
              {stockNote(chosen)}
              <Stepper p={chosen} />
            </div>
            {inCart.length ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                In your cart:
                {inCart.map((o) => (
                  <button key={o.id} type="button" onClick={() => setPick({ ...pick, [entry.id]: o.id })} className={`rounded-full border px-2 py-0.5 ${o.id === chosen.id ? "border-stone-500 bg-stone-100" : "border-stone-300 bg-white"}`}>{o.optionLabel} × {qty[o.id]}</button>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      </li>
    );
  };

  if (started) {
    const fee = started.cardFee;
    const withFee = started.totalCents + (fee?.estimateCents ?? 0);
    return (
      <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        {fee ? (
          <dl className="space-y-0.5 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-stone-500">Order</dt><dd>{money(started.totalCents, props.currency)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-stone-500">Card fee{fee.debitExempt ? " (credit cards)" : ""}</dt><dd>{money(fee.estimateCents, props.currency)}</dd></div>
            <div className="flex justify-between gap-4 font-medium"><dt>Total</dt><dd>{money(withFee, props.currency)}</dd></div>
            <p className="text-xs text-stone-500">{fee.notice}</p>
          </dl>
        ) : null}
        <p className="text-sm">{fee ? null : <>Total <b>{money(started.totalCents, props.currency)}</b> · </>}<button type="button" className="underline" onClick={() => setStarted(null)}>Edit order</button></p>
        {started.provider === "helcim" ? (
          <HelcimPayStep slug={props.slug} saleId={started.saleId} checkoutId={started.checkoutId} checkoutToken={started.checkoutToken} brand={props.brand} total={money(withFee, props.currency)} />
        ) : (
          <StripeCardPay
            publishableKey={started.publishableKey ?? props.publishableKey}
            stripeAccount={started.accountId}
            clientSecret={started.clientSecret}
            mode="payment"
            amountCents={withFee}
            currency={props.currency}
            wallets
            billing={{ name: `${buyer.firstName} ${buyer.lastName}`.trim() || undefined, email: buyer.email || undefined, phone: buyer.phone || undefined }}
            brand={props.brand}
            submitLabel={`Pay ${money(withFee, props.currency)}`}
            busyLabel="Paying…"
            prepare={async (pm) => applyOrderFeeAction(props.slug, started.saleId, started.clientSecret.split("_secret_")[0]!, pm)}
            done={async (intentId) => {
              // The card is authorized ("requires_capture"); the server captures it once the stock is checked again.
              const out = await finishOrderAction(props.slug, started.saleId, intentId);
              if (out.error) return out.error;
              router.push(`/book/${props.slug}/order/${started.saleId}?k=${encodeURIComponent(out.key ?? "")}`);
              return null;
            }}
          />
        )}
      </div>
    );
  }

  return (
    <form
      method="post"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const botToken = new FormData(e.currentTarget).get("cf-turnstile-response");
        start(async () => {
          const r = await startOrderAction({ botToken: typeof botToken === "string" ? botToken : null, slug: props.slug, items, giftCard: isGift ? { amountCents: giftCents, ...(forSomeone ? gift : { recipientName: "", recipientEmail: "", message: "" }) } : null, buyer, method: canShip ? method : "pickup", address, locationId: props.locationId ?? null });
          if ("error" in r) setError(r.error);
          else setStarted(r);
        });
      }}
    >
      {isGift ? (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium">Amount</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {props.gift!.presets.map((c) => (
              <button key={c} type="button" onClick={() => { setGiftAmount(c); setGiftCustom(""); }} className={`rounded-lg border px-3 py-1.5 text-sm ${!giftCustom && giftAmount === c ? "text-white" : "border-stone-300 bg-white"}`} style={!giftCustom && giftAmount === c ? { background: props.brand, borderColor: props.brand } : undefined}>{money(c, props.currency)}</button>
            ))}
            <Input value={giftCustom} onChange={(e) => setGiftCustom(e.target.value)} inputMode="decimal" placeholder="Other" className="w-24" />
          </div>
          <Checkbox checked={forSomeone} onChange={(e) => setForSomeone(e.target.checked)} label="This is a gift for someone else" hint="Otherwise we'll email the card to you." />
          {forSomeone ? (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Recipient's name"><Input value={gift.recipientName} onChange={(e) => setGift({ ...gift, recipientName: e.target.value })} /></Field>
                <Field label="Recipient's email" hint="Leave blank and we'll email it to you to pass on."><Input type="email" value={gift.recipientEmail} onChange={(e) => setGift({ ...gift, recipientEmail: e.target.value })} /></Field>
              </div>
              <Field label="Message (optional)"><Textarea rows={4} value={gift.message} onChange={(e) => setGift({ ...gift, message: e.target.value })} /></Field>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {shelf.map((entry) =>
            entry.kind === "single" ? (
              <li key={entry.p.id} className="flex items-center gap-3 px-4 py-3">
                {entry.p.imageUrl ? <img src={entry.p.imageUrl} alt="" className="h-14 w-14 rounded-lg border border-stone-200 object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{entry.p.name}</p>
                  {entry.p.description ? <p className="text-xs text-stone-500">{entry.p.description}</p> : null}
                  <p className="text-sm">{money(entry.p.priceCents, props.currency)}{stockNote(entry.p)}</p>
                </div>
                <Stepper p={entry.p} />
              </li>
            ) : (
              <GroupCard key={entry.id} entry={entry} />
            ),
          )}
        </ul>
      )}

      {(items.length > 0 || isGift) ? (
        <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
          {canShip ? (
            <RadioGroup inline>
              <Radio name="method" value="pickup" checked={method === "pickup"} onChange={() => setMethod("pickup")} label="Pick up in store" />
              <Radio name="method" value="ship" checked={method === "ship"} onChange={() => setMethod("ship")} label={`Ship (${money(props.shippingFlatCents, props.currency)})`} />
            </RadioGroup>
          ) : !isGift ? <p className="text-xs text-stone-500">Pick up in store.</p> : null}
          {method === "ship" && canShip ? <Field label="Shipping address"><Textarea rows={4} value={address} onChange={(e) => setAddress(e.target.value)} required /></Field> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><Input value={buyer.firstName} onChange={(e) => setBuyer({ ...buyer, firstName: e.target.value })} required /></Field>
            <Field label="Last name"><Input value={buyer.lastName} onChange={(e) => setBuyer({ ...buyer, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email (for your receipt)"><Input type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} required /></Field>
          <Field label="Mobile (optional)"><Input type="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></Field>
          <p className="text-sm">Subtotal {money(subtotal, props.currency)}{shipping ? ` + shipping ${money(shipping, props.currency)}` : ""}{!isGift ? " · tax added at checkout where applicable" : ""}</p>
          {error ? <Notice>{error}</Notice> : null}
          <PublicBotCheck resetKey={error} />
          <button type="submit" disabled={!hydrated || pending || (isGift ? !(giftCents >= 500) : items.length === 0)} className="inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60" style={{ background: props.brand }}>{pending ? "One moment…" : "Continue to payment"}</button>
        </div>
      ) : null}
    </form>
  );
}

/** Helcim: the card is authorised in Helcim's secure form; the server checks the stock again, then captures it (or releases it). */
function HelcimPayStep({ slug, saleId, checkoutId, checkoutToken, brand, total }: { slug: string; saleId: string; checkoutId: string; checkoutToken: string; brand: string; total: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const r = await openHelcimPay(checkoutToken, () => setError("Your card was declined. Try another card."));
      if (r.status !== "SUCCESS") { setBusy(false); return; }
      const out = await finishOrderAction(slug, saleId, checkoutId, r.message);
      if (out.error) { setError(out.error); setBusy(false); return; }
      router.push(`/book/${slug}/order/${saleId}?k=${encodeURIComponent(out.key ?? "")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The card form could not open.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error ? <Notice>{error}</Notice> : null}
      <button type="button" onClick={pay} disabled={busy} className="inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60" style={{ background: brand }}>{busy ? "Paying…" : `Pay ${total}`}</button>
      <p className="text-xs text-stone-500">Payments are processed by Helcim. Your card details never touch our servers.</p>
    </div>
  );
}
