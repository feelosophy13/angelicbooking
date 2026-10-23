"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { computeTotals, parseMoney } from "@angelic/core";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Button, Checkbox, Input, MoneyInput, Select, Textarea } from "@/components/ui";
import { ClientPicker } from "@/components/client-picker";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { formatMoney } from "@/lib/utils";
import { depositCents } from "@/lib/invoices";
import { quickCreateClient } from "../../clients/actions";
import { saveInvoice } from "./actions";

type Line =
  | { key: string; kind: "service"; serviceId: string; staffId: string; price: string }
  | { key: string; kind: "product"; productId: string; quantity: string; staffId: string }
  | { key: string; kind: "custom"; name: string; price: string; quantity: string; taxable: boolean; staffId: string };

export type InvoiceFieldsProps = {
  slug: string;
  currency: string;
  canCreateClient: boolean;
  serviceGroups: ServiceGroup[];
  servicePrices: Record<string, number>;
  /** A stylist's own price for a service: "staffId:serviceId" → cents. */
  staffPrices: Record<string, number>;
  productGroups: ServiceGroup[];
  products: Record<string, { priceCents: number; taxable: boolean }>;
  staff: { id: string; name: string }[];
  locations: { id: string; name: string; taxRateBps: number }[];
  defaultTaxRateBps: number;
  /** Editing: what the invoice holds now. */
  initial?: {
    invoiceId: string;
    client: { id: string; name: string };
    locationId: string | null;
    lines: Line[];
    discount: { type: "amount" | "percent"; value: number } | null;
    taxExempt: boolean;
    dueOn: string | null;
    note: string | null;
    deposit: { type: "amount" | "percent"; value: number } | null;
    remind: boolean;
    /** Lines added on the sale itself (a tip, a gift card), kept as they are. */
    otherLines: { name: string; amountCents: number }[];
  };
  defaultClient?: { id: string; name: string } | null;
  defaultDueOn: string;
};

let n = 0;
const key = () => `l${++n}`;
const cents = (v: string) => parseMoney(v) ?? 0;
const dollars = (c: number) => (c / 100).toFixed(2);

/** The invoice editor, for a new invoice and for changing one: client, lines, discount and tax, due date, deposit and note. */
export function InvoiceFields(props: InvoiceFieldsProps) {
  const init = props.initial;
  const money = (c: number) => formatMoney(c, props.currency);
  const [lines, setLines] = useState<Line[]>(init?.lines.length ? init.lines : [{ key: key(), kind: "service", serviceId: "", staffId: "", price: "" }]);
  const [locationId, setLocationId] = useState(init?.locationId ?? props.locations[0]?.id ?? "");
  const [discountType, setDiscountType] = useState<"none" | "amount" | "percent">(init?.discount?.type ?? "none");
  const [discountAmount, setDiscountAmount] = useState(init?.discount?.type === "amount" ? dollars(init.discount.value) : "");
  const [discountPercent, setDiscountPercent] = useState(init?.discount?.type === "percent" ? String(init.discount.value) : "");
  const [taxExempt, setTaxExempt] = useState(init?.taxExempt ?? false);
  const [depositType, setDepositType] = useState<"none" | "amount" | "percent">(init?.deposit?.type ?? "none");
  const [depositAmount, setDepositAmount] = useState(init?.deposit?.type === "amount" ? dollars(init.deposit.value) : "");
  const [depositPercent, setDepositPercent] = useState(init?.deposit?.type === "percent" ? String(init.deposit.value) : "50");

  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? ({ ...l, ...patch } as Line) : l)));
  const remove = (k: string) => setLines((ls) => ls.filter((l) => l.key !== k));
  const add = (kind: Line["kind"]) =>
    setLines((ls) => [...ls, kind === "service" ? { key: key(), kind, serviceId: "", staffId: "", price: "" } : kind === "product" ? { key: key(), kind, productId: "", quantity: "1", staffId: "" } : { key: key(), kind, name: "", price: "", quantity: "1", taxable: false, staffId: "" }]);

  const servicePrice = (l: Extract<Line, { kind: "service" }>) => (l.price.trim() ? cents(l.price) : (props.staffPrices[`${l.staffId}:${l.serviceId}`] ?? props.servicePrices[l.serviceId] ?? 0));
  const priced = lines.map((l) => {
    if (l.kind === "service") return { kind: "service" as const, amountCents: l.serviceId ? servicePrice(l) : 0, taxable: false };
    if (l.kind === "product") {
      const p = props.products[l.productId];
      return { kind: "product" as const, amountCents: (p?.priceCents ?? 0) * Math.max(1, Number(l.quantity) || 1), taxable: p?.taxable ?? false };
    }
    return { kind: "service" as const, amountCents: cents(l.price) * Math.max(1, Number(l.quantity) || 1), taxable: l.taxable };
  });
  const rate = taxExempt ? 0 : (props.locations.find((x) => x.id === locationId)?.taxRateBps ?? props.defaultTaxRateBps);
  const discount = discountType === "amount" && cents(discountAmount) > 0 ? { type: "amount" as const, value: cents(discountAmount) } : discountType === "percent" && Number(discountPercent) > 0 ? { type: "percent" as const, value: Number(discountPercent) } : null;
  const others = init?.otherLines ?? [];
  const t = computeTotals([...priced.map((p) => ({ ...p, staffId: null, serviceId: null })), ...others.map((o) => ({ kind: "fee" as const, amountCents: o.amountCents, taxable: false, staffId: null, serviceId: null }))], discount, rate);
  const dep = depositType === "none" ? null : depositCents(depositType === "amount" ? { type: "amount", value: cents(depositAmount) } : { type: "percent", value: Number(depositPercent) || 0 }, t.totalCents);

  const payload = JSON.stringify(
    lines.map((l) =>
      l.kind === "service"
        ? { kind: "service", serviceId: l.serviceId, staffId: l.staffId || null, priceCents: l.price.trim() ? cents(l.price) : null }
        : l.kind === "product"
          ? { kind: "product", productId: l.productId, quantity: Math.max(1, Math.round(Number(l.quantity) || 1)), staffId: l.staffId || null }
          : { kind: "custom", name: l.name, unitCents: cents(l.price), quantity: Math.max(1, Math.round(Number(l.quantity) || 1)), taxable: l.taxable, staffId: l.staffId || null },
    ),
  );
  const staffSelect = (l: Line) => (
    <Select aria-label="Staff credited" value={l.staffId} onChange={(e) => set(l.key, { staffId: e.target.value })}>
      <option value="">No staff</option>
      {props.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  );

  return (
    <ActionForm action={saveInvoice}>
      <input type="hidden" name="slug" value={props.slug} />
      {init ? <input type="hidden" name="invoiceId" value={init.invoiceId} /> : null}
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" name="clientId" required>
          <ClientPicker slug={props.slug} initial={init?.client ?? props.defaultClient ?? null} canCreate={props.canCreateClient} createClient={quickCreateClient} placeholder="Search clients" allowWalkIn={false} />
        </Field>
        {props.locations.length > 1 ? (
          <Field label="Location" name="locationId" hint="Decides the tax rate and which account takes the payment.">
            <Select name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {props.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        ) : <input type="hidden" name="locationId" value={locationId} />}
      </div>

      <Field label="What it's for" name="lines">
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
          {lines.map((l, i) => (
            <li key={l.key} className="space-y-2 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {l.kind === "service" ? (
                    <ServicePicker name={`service_${i}`} groups={props.serviceGroups} value={l.serviceId || null} onPick={(id) => set(l.key, { serviceId: id, price: "" })} />
                  ) : l.kind === "product" ? (
                    <ServicePicker name={`product_${i}`} groups={props.productGroups} value={l.productId || null} placeholder="Choose a product" onPick={(id) => set(l.key, { productId: id })} />
                  ) : (
                    <Input aria-label="Description" placeholder="Description (e.g. Bridal trial, travel to venue)" value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} maxLength={120} />
                  )}
                </div>
                <span className="w-24 shrink-0 pt-2 text-right text-sm tabular-nums">{money(priced[i]!.amountCents)}</span>
                <button type="button" onClick={() => remove(l.key)} className="hit mt-1.5 rounded p-1 text-stone-400 hover:text-stone-700" aria-label="Remove line"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {l.kind === "service" ? (
                  <>
                    {staffSelect(l)}
                    <MoneyInput aria-label="Price" currency={props.currency} placeholder={l.serviceId ? dollars(servicePrice({ ...l, price: "" })) : "0.00"} value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} />
                  </>
                ) : l.kind === "product" ? (
                  <>
                    {staffSelect(l)}
                    <Input aria-label="Quantity" type="number" min={1} max={99} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
                  </>
                ) : (
                  <>
                    {staffSelect(l)}
                    <MoneyInput aria-label="Price each" currency={props.currency} value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} />
                    <Input aria-label="Quantity" type="number" min={1} max={99} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
                    <Checkbox className="col-span-2 sm:col-span-3" label="Taxable" checked={l.taxable} onChange={(e) => set(l.key, { taxable: e.target.checked })} />
                  </>
                )}
              </div>
            </li>
          ))}
          {others.map((o, i) => (
            <li key={`o${i}`} className="flex items-center justify-between p-3 text-sm text-stone-600"><span>{o.name} <span className="text-xs text-stone-400">(added on the sale)</span></span><span className="w-24 text-right tabular-nums">{money(o.amountCents)}</span></li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => add("service")}><Plus className="h-4 w-4" /> Service</Button>
          {Object.keys(props.products).length ? <Button type="button" size="sm" variant="secondary" onClick={() => add("product")}><Plus className="h-4 w-4" /> Product</Button> : null}
          <Button type="button" size="sm" variant="secondary" onClick={() => add("custom")}><Plus className="h-4 w-4" /> Custom line</Button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Discount" name="discountType">
          <Select name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)}>
            <option value="none">No discount</option>
            <option value="amount">Amount off</option>
            <option value="percent">Percent off</option>
          </Select>
        </Field>
        {discountType === "amount" ? <Field label="Amount off" name="discountAmount"><MoneyInput name="discountAmount" currency={props.currency} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} /></Field> : null}
        {discountType === "percent" ? <Field label="Percent off" name="discountPercent"><Input name="discountPercent" type="number" min={1} max={100} inputMode="numeric" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} /></Field> : null}
      </div>
      <Checkbox name="taxExempt" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} label="No sales tax on this invoice" hint="Products and taxable lines are otherwise taxed at the location's rate." />

      <dl className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(t.subtotalCents)}</dd></div>
        {t.discountCents ? <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">-{money(t.discountCents)}</dd></div> : null}
        {t.taxCents ? <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{money(t.taxCents)}</dd></div> : null}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(t.totalCents)}</dd></div>
        {dep ? <div className="flex justify-between text-stone-600"><dt>Deposit due now</dt><dd className="tabular-nums">{money(dep)}</dd></div> : null}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Due date" name="dueOn" hint="Leave blank for “due on receipt”.">
          <Input name="dueOn" type="date" defaultValue={init ? (init.dueOn ?? "") : props.defaultDueOn} />
        </Field>
        <Field label="Deposit" name="depositType" hint="Ask for part now; the client pays the rest later from the same link.">
          <Select name="depositType" value={depositType} onChange={(e) => setDepositType(e.target.value as typeof depositType)}>
            <option value="none">No deposit: the full amount</option>
            <option value="percent">A percent now</option>
            <option value="amount">An amount now</option>
          </Select>
        </Field>
        {depositType === "percent" ? <Field label="Deposit percent" name="depositPercent"><Input name="depositPercent" type="number" min={1} max={99} inputMode="numeric" value={depositPercent} onChange={(e) => setDepositPercent(e.target.value)} /></Field> : null}
        {depositType === "amount" ? <Field label="Deposit amount" name="depositAmount"><MoneyInput name="depositAmount" currency={props.currency} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></Field> : null}
      </div>
      <Field label="Note to the client" name="note" hint="Shown on the invoice and in the email.">
        <Textarea name="note" defaultValue={init?.note ?? ""} maxLength={1000} placeholder="Thank you for choosing us for your big day!" />
      </Field>
      <Checkbox name="remind" defaultChecked={init?.remind ?? true} label="Send reminders" hint="Three days before the due date, on it, a day after and a week after, until it is paid." />
      <SubmitButton pendingText="Saving…">{init ? "Save changes" : "Save invoice"}</SubmitButton>
    </ActionForm>
  );
}
