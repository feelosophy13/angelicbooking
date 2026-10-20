import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireAction, requireBusiness } from "@/lib/tenant";
import { canSeeCosts } from "@/lib/visibility";
import { listCategories } from "@/server/categories";
import { Button, Card, FormPage, Input, LinkButton, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { ProductFields } from "@/components/product-fields";
import { CategoryPicker } from "@/components/categories";
import { undoReceiptAction } from "../../inventory/actions";
import { ConfirmSubmit } from "@/components/form";
import { addProductBarcode, adjustStock, deleteProductBarcode, makeProductOptions, transferStockAction, updateProduct } from "../actions";
import { listExtraBarcodes, listLocations, listSuppliers, productMovements, stockByLocation } from "@/server/inventory";
import { MANUAL_REASONS, movementReason, productLabel, stockStatus } from "@/lib/inventory";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productId: string }> }): Promise<Metadata> {
  const { slug, productId } = await params;
  const { business } = await requireBusiness(slug);
  const p = await withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId) }));
  return { title: p ? `${productLabel(p)} · Products` : "Product" };
}

const REASON_CHOICES: Record<(typeof MANUAL_REASONS)[number], string> = {
  received: "Received (adds)",
  adjust: "Correct the count (+ or −)",
  damage: "Damaged (removes)",
  theft: "Stolen (removes)",
  expired: "Expired (removes)",
  lost: "Lost (removes)",
  supplier_return: "Sent back to supplier (removes)",
  used: "Used in a service (removes)",
};

export default async function EditProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  const ctx = await requireBusiness(slug);
  const { business, permissions } = ctx;
  const canEdit = can(permissions, "services.manage");
  const canStock = can(permissions, "inventory.manage");
  if (!canEdit && !canStock) await requireAction(slug, "services.manage");
  const showCost = canSeeCosts(permissions); // I3: what a product costs is its own permission
  const [product, categories, suppliers, locations] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId) })),
    listCategories(business.id, "product"),
    listSuppliers(business.id),
    listLocations(business.id),
  ]);
  if (!product) notFound();
  const extraCodes = canStock ? await listExtraBarcodes(business.id, product.id) : [];
  const [movements, levels] = canStock ? await Promise.all([productMovements(business.id, product.id), stockByLocation(business.id, product.id)]) : [[], []];
  const multi = locations.length > 1;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  const status = stockStatus(product.stockQty, product.lowStockThreshold);
  const tone = status === "ok" ? "" : status === "low" ? "text-amber-700" : "text-red-700";
  return (
    <FormPage title={productLabel(product)} backHref={`/app/${slug}/products`} backLabel="Products">
      {canStock ? (
        <Card className="mb-5 p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Stock on hand</h2>
            {product.trackStock ? <span className={`text-xl font-semibold ${tone}`}>{product.stockQty}</span> : <span className="text-sm text-stone-500">Not tracked yet</span>}
          </div>
          {status === "negative" ? <p className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">More has gone out than the count said. Count the shelf and correct it below.</p> : null}
          {!product.trackStock ? <p className="mb-2 text-xs text-stone-500">Receiving or counting stock turns tracking on.</p> : null}
          {multi && levels.length ? (
            <ul className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
              {levels.map((l) => <li key={l.locationId} className="flex justify-between rounded-md bg-stone-50 px-2 py-1"><span className="text-stone-600">{l.name.replace(`${business.name} - `, "")}</span><span className={l.qty < 0 ? "font-medium text-red-700" : "font-medium"}>{l.qty}</span></li>)}
            </ul>
          ) : null}
          <ActionForm action={adjustStock}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="productId" value={product.id} />
            <div className={`grid gap-2 sm:grid-cols-2 ${multi ? "lg:grid-cols-[14rem_10rem_5rem_1fr]" : "lg:grid-cols-[14rem_5rem_1fr]"}`}>
              <Field label="What happened" name="reason"><Select name="reason" defaultValue="received">{MANUAL_REASONS.map((r) => <option key={r} value={r}>{REASON_CHOICES[r]}</option>)}</Select></Field>
              {multi ? <Field label="Where" name="locationId"><Select name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field> : null}
              <Field label="How many" name="delta"><Input name="delta" inputMode="numeric" /></Field>
              <Field label="Note" name="note"><Input name="note" placeholder="Invoice #, what happened…" /></Field>
            </div>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Record</SubmitButton>
          </ActionForm>
          {multi && levels.length ? (
            <Disclosure title="Move to another location" className="mt-3">
              <ActionForm action={transferStockAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="productId" value={product.id} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_5rem]">
                  <Field label="From" name="fromLocationId"><Select name="fromLocationId" defaultValue={levels.find((l) => l.qty > 0)?.locationId}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field>
                  <Field label="To" name="toLocationId"><Select name="toLocationId" defaultValue={locations.find((l) => l.id !== levels.find((x) => x.qty > 0)?.locationId)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field>
                  <Field label="How many" name="qty"><Input name="qty" inputMode="numeric" /></Field>
                </div>
                <SubmitButton size="sm" variant="secondary" pendingText="Moving…">Move stock</SubmitButton>
              </ActionForm>
            </Disclosure>
          ) : null}
          {movements.length ? (
            <ul className="mt-3 max-h-48 space-y-0.5 overflow-y-auto border-t border-stone-200 pt-2 text-xs text-stone-600">
              {movements.map((m) => (
                <li key={m.id}>
                  {fmt.format(m.createdAt)} · <span className={m.delta >= 0 ? "text-emerald-700" : "text-red-700"}>{m.delta > 0 ? "+" : ""}{m.delta}</span> · {movementReason(m.reason)}
                  {multi && m.location ? ` · ${m.location.replace(`${business.name} - `, "")}` : ""}{m.note ? ` · ${m.note}` : ""}{m.who ? ` · ${m.who}` : ""}
                  {m.undone ? " · undone" : null}
                  {m.reason === "received" && m.delta > 0 && !m.reversesMovementId && !m.undone ? (
                    <form action={undoReceiptAction} className="ml-2 inline">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="movementId" value={m.id} />
                      <ConfirmSubmit title={`Undo this delivery of ${m.delta}?`} body="The stock goes down by that many (and the order, if it was on one, shows them as not yet received)." confirmLabel="Undo delivery" variant="danger" size="sm" className="!h-auto !px-1 !py-0 text-xs underline">Undo</ConfirmSubmit>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {movements.length ? <Link href={`/app/${slug}/inventory/history?range=all&product=${product.id}`} className="mt-2 inline-block text-xs text-brand-700 underline">See all history</Link> : null}
        </Card>
      ) : null}
      {canStock ? (
        <Disclosure title="Other barcodes" hint={extraCodes.length ? `${extraCodes.length} added` : "cases, other pack sizes"} className="mb-5">
          <p className="mb-2 text-xs text-stone-500">The barcode above is its main one. Add another for a case or a different pack: scanning it adds that many units.</p>
          {extraCodes.length ? (
            <ul className="mb-3 divide-y divide-stone-100 text-sm">
              {extraCodes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span><span className="font-mono">{c.code}</span> <span className="text-stone-500">· {c.unitsPerScan} unit{c.unitsPerScan === 1 ? "" : "s"} a scan</span></span>
                  <form action={deleteProductBarcode}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="id" value={c.id} />
                    <Button size="sm" variant="ghost" type="submit">Remove</Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={addProductBarcode}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="productId" value={product.id} />
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Field label="Barcode" name="code"><Input name="code" inputMode="numeric" placeholder="Scan or type it" /></Field>
              <Field label="Units a scan" name="units"><Input name="units" inputMode="numeric" defaultValue="1" /></Field>
            </div>
            <SubmitButton size="sm" variant="secondary" pendingText="Adding…">Add barcode</SubmitButton>
          </ActionForm>
        </Disclosure>
      ) : null}
      {canEdit ? (
        <>
          {product.groupId ? (
            <p className="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">This is one option of <Link href={`/app/${slug}/products/group/${product.groupId}`} className="font-medium text-brand-700 underline">{product.name}</Link>. Its name, category, photo, description and online-store settings are shared, so change those there. Its own price, cost, codes and stock are below.</p>
          ) : (
            <Disclosure title="Comes in sizes or shades?" hint="turn it into a product with options" className="mb-4">
              <ActionForm action={makeProductOptions}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="productId" value={product.id} />
                <Field label="What is this one called?" name="label" hint={'It becomes the first option. For example "50 ml" or "7N". You add the others next.'}><Input name="label" placeholder="50 ml" /></Field>
                <SubmitButton size="sm" variant="secondary" pendingText="Working…">Add options</SubmitButton>
              </ActionForm>
            </Disclosure>
          )}
          <ActionForm action={updateProduct}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="productId" value={product.id} />
            <ProductFields mode={product.groupId ? "option" : "plain"} showCost={showCost} product={product} category={<CategoryPicker name="categoryId" categories={categories} value={product.categoryId} />} suppliers={suppliers} currency={business.currency} storeOn={business.storeEnabled} slug={slug} />
            <SubmitButton pendingText="Saving…">Save {product.groupId ? "option" : "product"}</SubmitButton>
          </ActionForm>
        </>
      ) : (
        <LinkButton href={`/app/${slug}/inventory`}>Back to inventory</LinkButton>
      )}
    </FormPage>
  );
}
