import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { getPurchaseOrder, listLocations, listSuppliers, orderReceipts } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { dateLong } from "@/lib/format";
import { formatMoney } from "@/lib/utils";
import { BackLink, Button, Card, Input, LinkButton, MoneyInput, PageHeader, Select, Textarea } from "@/components/ui";
import { ScanBarcode } from "lucide-react";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { addOrderLine, orderAction, receiveOrderAction, saveOrder, undoReceiptAction } from "../../actions";
import { StatusPill } from "../status-pill";

export const metadata: Metadata = { title: "Order · Inventory" };

export default async function OrderPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const data = await getPurchaseOrder(business.id, id);
  if (!data) notFound();
  const { po, supplier, lines } = data;
  const open = po.status === "draft" || po.status === "ordered" || po.status === "partial";
  const receipts = await orderReceipts(business.id, po.id);
  const [suppliers, locations, products] = await Promise.all([
    listSuppliers(business.id),
    listLocations(business.id),
    open
      ? withTenant(business.id, (tx) => tx.select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel }).from(schema.products).where(and(eq(schema.products.active, true))).orderBy(asc(schema.products.name), asc(schema.products.variantLabel)))
      : Promise.resolve([]),
  ]);
  const money = (c: number) => formatMoney(c, business.currency);
  const have = new Set(lines.map((l) => l.productId));
  const total = lines.reduce((s, l) => s + l.orderedQty * l.unitCostCents, 0);
  const remaining = lines.filter((l) => l.receivedQty < l.orderedQty);
  const where = locations.find((l) => l.id === po.locationId);
  const mail = supplier?.email
    ? `mailto:${supplier.email}?subject=${encodeURIComponent(`Order #${po.number} from ${business.name}`)}&body=${encodeURIComponent(`Hello${supplier.contactName ? ` ${supplier.contactName}` : ""},\n\nPlease supply:\n\n${lines.map((l) => `${l.orderedQty} × ${l.label}${l.sku ? ` (${l.sku})` : ""}`).join("\n")}\n\n${po.expectedOn ? `Needed by ${dateLong(po.expectedOn)}.\n` : ""}${supplier.accountNumber ? `Account: ${supplier.accountNumber}\n` : ""}\nThank you,\n${business.name}`)}`
    : null;

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/inventory/orders`}>Orders</BackLink></div>
      <PageHeader title={`Order #${po.number}`}>
        <StatusPill status={po.status} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            {open ? (
              <ActionForm action={saveOrder}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="orderId" value={po.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  {suppliers.length ? <Field label="Supplier" name="supplierId"><Select name="supplierId" defaultValue={po.supplierId ?? ""}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field> : <input type="hidden" name="supplierId" value={po.supplierId ?? ""} />}
                  {locations.length > 1 ? <Field label="Deliver to" name="locationId"><Select name="locationId" defaultValue={po.locationId ?? ""}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field> : <input type="hidden" name="locationId" value={po.locationId ?? ""} />}
                  <Field label="Expected on" name="expectedOn"><Input type="date" name="expectedOn" defaultValue={po.expectedOn ?? ""} /></Field>
                  <Field label="Supplier's reference" name="reference" hint="Their order or invoice number."><Input name="reference" defaultValue={po.reference ?? ""} /></Field>
                </div>
                <Field label="Notes" name="notes"><Textarea name="notes" rows={2} defaultValue={po.notes ?? ""} /></Field>
                {lines.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-stone-500"><tr><th className="py-1">Product</th><th className="w-24 py-1 pr-2">Ordered</th><th className="w-28 py-1 pr-2">Unit cost</th><th className="w-20 py-1 text-right">Received</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-1.5 pr-2">{l.label}{l.sku ? <span className="block text-xs text-stone-500">{l.sku}</span> : null}</td>
                          <td className="py-1.5 pr-2"><Input name={`ord:${l.productId}`} defaultValue={l.orderedQty} inputMode="numeric" aria-label={`Quantity of ${l.label}`} className="text-right" /></td>
                          <td className="py-1.5 pr-2"><MoneyInput name={`cost:${l.productId}`} currency={business.currency} defaultValue={l.unitCostCents ? (l.unitCostCents / 100).toFixed(2) : ""} aria-label={`Unit cost of ${l.label}`} /></td>
                          <td className="py-1.5 text-right tabular-nums text-stone-600">{l.receivedQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-sm text-stone-500">No products yet. Add some below.</p>}
                <div className="flex items-center justify-between gap-3">
                  <SubmitButton variant="secondary" pendingText="Saving…">Save changes</SubmitButton>
                  <span className="text-sm font-medium">Total {money(total)}</span>
                </div>
                <p className="text-xs text-stone-500">Set a quantity to 0 to remove a line that hasn't arrived.</p>
              </ActionForm>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-stone-600">{supplier?.name ?? "No supplier"}{where ? ` · ${where.name.replace(`${business.name} - `, "")}` : ""}{po.expectedOn ? ` · expected ${dateLong(po.expectedOn)}` : ""}{po.reference ? ` · ref ${po.reference}` : ""}</p>
                {po.notes ? <p className="text-stone-600">{po.notes}</p> : null}
                <ul className="divide-y divide-stone-100">
                  {lines.map((l) => <li key={l.id} className="flex justify-between gap-3 py-1.5"><span>{l.label}</span><span className="tabular-nums text-stone-600">{l.receivedQty} of {l.orderedQty} · {money(l.unitCostCents)}</span></li>)}
                </ul>
                <p className="text-right font-medium">Total {money(total)}</p>
              </div>
            )}
          </Card>

          {receipts.length ? (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-medium text-stone-700">Deliveries received</h2>
              <p className="mb-2 text-xs text-stone-500">Entered a wrong number? Undo that delivery and enter it again. The stock and this order go back to how they were.</p>
              <ul className="divide-y divide-stone-100 text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                    <span className={r.undone ? "text-stone-400 line-through" : ""}>{r.label} <span className="text-stone-500">× {r.qty}</span></span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-stone-500">
                      {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone }).format(r.at)}{r.who ? ` · ${r.who}` : ""}
                      {r.undone ? <span>undone</span> : (
                        <form action={undoReceiptAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="movementId" value={r.id} />
                          <ConfirmSubmit title={`Undo ${r.qty} × ${r.label}?`} body="The stock goes down by that many and the order shows them as not yet received." confirmLabel="Undo delivery" variant="danger" size="sm">Undo</ConfirmSubmit>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {open ? (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-medium text-stone-700">Add a product</h2>
              <ActionForm action={addOrderLine}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="orderId" value={po.id} />
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                  <Select name="productId" aria-label="Product" defaultValue="">
                    <option value="" disabled>Choose a product…</option>
                    {products.filter((p) => !have.has(p.id)).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                  </Select>
                  <Input name="qty" inputMode="numeric" placeholder="Qty" aria-label="Quantity" />
                </div>
                <SubmitButton size="sm" variant="secondary" pendingText="Adding…">Add</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        {open ? (
          <div className="space-y-4">
            {po.status === "draft" ? (
              <Card className="space-y-2 p-4">
                <h2 className="text-sm font-medium text-stone-700">Send it</h2>
                <p className="text-xs text-stone-500">Place the order with your supplier, then mark it ordered so it counts as on its way and isn't suggested again.</p>
                {mail ? <a href={mail} className="inline-flex h-9 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50">Email {supplier?.name}</a> : supplier ? <p className="text-xs text-stone-500">Add an email to {supplier.name} to write to them from here.</p> : null}
                <form action={orderAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="orderId" value={po.id} />
                  <input type="hidden" name="do" value="order" />
                  <Button type="submit" size="sm">Mark as ordered</Button>
                </form>
              </Card>
            ) : null}
            {lines.length ? <Card className="p-4">
              <h2 className="mb-2 text-sm font-medium text-stone-700">Receive a delivery</h2>
              <LinkButton href={`/app/${slug}/inventory/orders/${po.id}/scan`} variant="primary" size="sm" className="mb-3"><ScanBarcode className="h-4 w-4" /> Scan the delivery</LinkButton>
              {remaining.length === 0 ? <p className="text-sm text-stone-500">Everything on this order has arrived.</p> : (
                <ActionForm action={receiveOrderAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="orderId" value={po.id} />
                  <p className="text-xs text-stone-500">How many arrived, and what each cost. Part of an order is fine; the rest stays on order.</p>
                  <ul className="space-y-2">
                    {remaining.map((l) => (
                      <li key={l.id} className="grid grid-cols-[1fr_4rem_5.5rem] items-center gap-2 text-sm">
                        <span className="min-w-0 truncate" title={l.label}>{l.label} <span className="text-xs text-stone-500">({l.orderedQty - l.receivedQty} due)</span></span>
                        <Input name={`got:${l.id}`} defaultValue={l.orderedQty - l.receivedQty} inputMode="numeric" aria-label={`Received of ${l.label}`} className="text-right" />
                        <MoneyInput name={`paid:${l.id}`} currency={business.currency} defaultValue={l.unitCostCents ? (l.unitCostCents / 100).toFixed(2) : ""} aria-label={`Unit cost of ${l.label}`} />
                      </li>
                    ))}
                  </ul>
                  <Field label="Invoice or delivery number" name="reference"><Input name="reference" defaultValue={po.reference ?? ""} /></Field>
                  <SubmitButton pendingText="Receiving…">Add to stock</SubmitButton>
                </ActionForm>
              )}
            </Card> : null}
            <form action={orderAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="orderId" value={po.id} />
              <input type="hidden" name="do" value="cancel" />
              <ConfirmSubmit title={`Cancel order #${po.number}?`} body="What has already been received stays in stock. The rest is no longer expected." confirmLabel="Cancel order">Cancel this order</ConfirmSubmit>
            </form>
          </div>
        ) : null}
      </div>
    </>
  );
}
