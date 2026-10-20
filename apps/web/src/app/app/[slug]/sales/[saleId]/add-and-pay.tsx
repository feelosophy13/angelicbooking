"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Input, MoneyInput, Select } from "@/components/ui";
import { SaleProductPicker, type PickerProduct } from "@/components/sale-product-picker";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { ExternalCardForm, GiftCardPayForm, ManualPayForm, PointsPayForm, SavedCardForm, Segmented, StoreCreditPayForm } from "./forms";
import { CardPayment } from "./card-payment";
import { TerminalPayment } from "./terminal-payment";
import type { SaleActionState } from "./actions";

type PlainAction = (fd: FormData) => Promise<void>;
type StateAction = (prev: SaleActionState, fd: FormData) => Promise<SaleActionState>;
type Staff = { id: string; name: string };
type AddKind = "product" | "service" | "gift_card" | "package" | "membership";

const ADD_LABELS: Record<AddKind, string> = { product: "Product", service: "Service", gift_card: "Gift card", package: "Package", membership: "Membership" };

/**
 * Everything that can go on an open ticket, behind one choice of what is being added, so the desk only ever
 * sees the fields for that one thing. Kinds with nothing to offer (no packages, no plans, no client for a
 * membership) are not offered at all.
 */
export function AddToTicket({ slug, saleId, start, staff, products, productsHref, autoFocus, groups, packages, plans, actions }: {
  slug: string;
  saleId: string;
  /** On the blank checkout page: the client and location the ticket opens with when its first item goes on. */
  start?: { clientId: string | null; locationId: string | null };
  staff: Staff[];
  products: PickerProduct[];
  productsHref: string;
  autoFocus: boolean;
  groups: ServiceGroup[];
  /** Active packages, or nothing to hide the kind. */
  packages: { id: string; label: string }[];
  /** Active plans the attached client could join, or nothing to hide the kind. */
  plans: { id: string; label: string }[];
  actions: { addProduct: PlainAction; addProductByCode: PlainAction; addService: PlainAction; addOffer: PlainAction };
}) {
  const kinds: AddKind[] = ["product", "service", "gift_card", ...(packages.length ? ["package" as const] : []), ...(plans.length ? ["membership" as const] : [])];
  const [kind, setKind] = useState<AddKind>("product");
  const ids = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="saleId" value={saleId} />
      {start?.clientId ? <input type="hidden" name="clientId" value={start.clientId} /> : null}
      {start?.locationId ? <input type="hidden" name="locationId" value={start.locationId} /> : null}
    </>
  );
  const whoSold = (label: string) => (
    <Select name="staffId" defaultValue="" required aria-label={label}>
      <option value="" disabled>{label}</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      <option value="none">No staff credit</option>
    </Select>
  );
  return (
    <div className="space-y-3">
      <Segmented label="What to add" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: ADD_LABELS[k] }))} />
      {kind === "product" ? (
        products.length === 0 ? (
          <p className="text-sm text-stone-500">No products yet. Add some under <Link className="underline" href={productsHref}>Products</Link>.</p>
        ) : (
          <form action={actions.addProduct} className="space-y-2">
            {ids}
            <SaleProductPicker autoFocus={autoFocus} products={products} />
            <div className="grid grid-cols-[5rem_1fr] gap-2">
              <Input name="quantity" type="number" min={1} max={99} defaultValue={1} aria-label="Quantity" />
              {/* No default: whoever sold it has to be chosen, so commission never lands on a guess. "No staff credit" is a deliberate choice. */}
              {whoSold("Who gets credit?")}
            </div>
            <p className="text-xs text-stone-500">Choose who gets credit, then tap a product (or scan one) to add it with this quantity.</p>
            <div className="flex gap-2">
              <Input name="code" placeholder="Scan a barcode or type a SKU" aria-label="Barcode or SKU" autoComplete="off" className="min-w-0 flex-1" />
              <Button type="submit" formAction={actions.addProductByCode} variant="secondary">Add</Button>
            </div>
          </form>
        )
      ) : kind === "service" ? (
        <form action={actions.addService} className="space-y-2">
          {ids}
          <ServicePicker name="serviceId" groups={groups} value={null} />
          <div className="grid grid-cols-2 gap-2">
            {whoSold("Who performed it?")}
            <MoneyInput name="price" placeholder="Price (optional)" aria-label="Price" />
          </div>
          <Button type="submit" size="sm" variant="secondary">Add service</Button>
        </form>
      ) : kind === "gift_card" ? (
        <form action={actions.addOffer} className="space-y-2">
          {ids}
          <input type="hidden" name="kind" value="gift_card" />
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput name="amount" placeholder="Amount" aria-label="Gift card amount" required />
            <Input name="recipientName" placeholder="Recipient (optional)" aria-label="Recipient" />
          </div>
          <Button type="submit" size="sm" variant="secondary">Add gift card</Button>
        </form>
      ) : kind === "package" ? (
        <form action={actions.addOffer} className="space-y-2">
          {ids}
          <input type="hidden" name="kind" value="package" />
          <div className="grid grid-cols-2 gap-2">
            <Select name="refId" required aria-label="Package">{packages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            {whoSold("Who sold it?")}
          </div>
          <Button type="submit" size="sm" variant="secondary">Add package</Button>
        </form>
      ) : (
        <form action={actions.addOffer} className="space-y-2">
          {ids}
          <input type="hidden" name="kind" value="membership" />
          <Select name="refId" required aria-label="Membership">{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
          <Button type="submit" size="sm" variant="secondary">Add membership</Button>
        </form>
      )}
    </div>
  );
}

type PayMethod = "cash" | "card" | "gift_card" | "store_credit" | "points";
type CardWay = "saved" | "reader" | "typed" | "own";

/**
 * Taking payment: pick how, then see only that method's fields. Methods the client can't use (no store credit,
 * too few points) are not offered. Card is always there: without a connected processor it is the salon's own card machine.
 */
export function TakePayment({ slug, saleId, dueCents, currency, hasClient, savedCards, stripe, storeCredit, points, actions }: {
  slug: string;
  saleId: string;
  dueCents: number;
  currency: string;
  hasClient: boolean;
  savedCards: { id: string; brand: string; last4: string; expMonth: number; expYear: number }[];
  /** Null when cards can't be taken through Stripe. */
  stripe: { publishableKey: string | null; test: boolean } | null;
  /** Balance to spend, or 0. */
  storeCredit: number;
  /** Null when loyalty is off, the client has too few points, or there is no client. */
  points: { balance: number; pointValueCents: number; minPoints: number } | null;
  actions: { payManual: StateAction; payWithGiftCard: StateAction; payWithSavedCard: StateAction; payWithStoreCredit: StateAction; payWithPoints: StateAction };
}) {
  const methods: { value: PayMethod; label: string }[] = [
    { value: "card", label: "Card" },
    { value: "cash", label: "Cash / other" },
    { value: "gift_card", label: "Gift card" },
    ...(storeCredit > 0 ? [{ value: "store_credit" as const, label: "Store credit" }] : []),
    ...(points ? [{ value: "points" as const, label: "Points" }] : []),
  ];
  const [method, setMethod] = useState<PayMethod>(methods[0]!.value);
  const ways: { value: CardWay; label: string }[] = [
    ...(stripe && savedCards.length ? [{ value: "saved" as const, label: "Card on file" }] : []),
    ...(stripe ? [{ value: "reader" as const, label: "Card reader" }, { value: "typed" as const, label: "Type it in" }] : []),
    { value: "own", label: "Own card machine" },
  ];
  const [way, setWay] = useState<CardWay>(ways[0]!.value);
  return (
    <div className="space-y-3">
      <Segmented label="Pay by" value={method} onChange={setMethod} options={methods} />
      {method === "cash" ? (
        <ManualPayForm key={dueCents} currency={currency} action={actions.payManual} slug={slug} saleId={saleId} dueCents={dueCents} />
      ) : method === "gift_card" ? (
        <GiftCardPayForm key={`gc${dueCents}`} action={actions.payWithGiftCard} slug={slug} saleId={saleId} dueCents={dueCents} />
      ) : method === "store_credit" ? (
        <StoreCreditPayForm key={`sc${dueCents}`} action={actions.payWithStoreCredit} slug={slug} saleId={saleId} balanceCents={storeCredit} dueCents={dueCents} />
      ) : method === "points" && points ? (
        <PointsPayForm key={`pt${dueCents}`} action={actions.payWithPoints} slug={slug} saleId={saleId} balance={points.balance} pointValueCents={points.pointValueCents} dueCents={dueCents} minPoints={points.minPoints} />
      ) : method === "card" ? (
        <div className="space-y-3">
          {ways.length > 1 ? <Segmented label="Which card" value={way} onChange={setWay} options={ways} /> : null}
          {way === "saved" && stripe ? (
            <SavedCardForm key={dueCents} action={actions.payWithSavedCard} slug={slug} saleId={saleId} dueCents={dueCents} cards={savedCards} />
          ) : way === "reader" && stripe ? (
            <TerminalPayment key={`tp${dueCents}`} slug={slug} saleId={saleId} dueCents={dueCents} hasClient={hasClient} test={stripe.test} />
          ) : way === "typed" && stripe ? (
            <CardPayment key={`cp${dueCents}`} slug={slug} saleId={saleId} dueCents={dueCents} publishableKey={stripe.publishableKey} hasClient={hasClient} />
          ) : (
            <ExternalCardForm key={`ex${dueCents}`} action={actions.payManual} slug={slug} saleId={saleId} dueCents={dueCents} />
          )}
        </div>
      ) : null}
    </div>
  );
}
