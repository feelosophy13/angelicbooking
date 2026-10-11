import { ImageField } from "@/components/image-field";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Card, FormPage, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { adjustStock, updateProduct } from "../actions";
import { productMovements } from "@/server/inventory";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productId: string }> }): Promise<Metadata> {
  const { slug, productId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const p = await withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId) }));
  return { title: p ? `${p.name} · Products` : "Product" };
}

export default async function EditProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [product, categories] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId) })),
    listCategories(business.id, "product"),
  ]);
  if (!product) notFound();
  const movements = product.trackStock ? await productMovements(business.id, product.id) : [];
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <FormPage title={product.name} backHref={`/app/${slug}/products`} backLabel="Products" width="max-w-xl">
      {product.trackStock ? (
        <Card className="mb-5 p-4">
          <div className="mb-2 flex items-baseline justify-between"><h2 className="font-medium">Stock on hand</h2><span className={`text-xl font-semibold ${product.stockQty <= product.lowStockThreshold ? "text-amber-700" : ""}`}>{product.stockQty}</span></div>
          <ActionForm action={adjustStock}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="productId" value={product.id} />
            <div className="grid grid-cols-[8rem_6rem_1fr] gap-2">
              <Select name="reason" defaultValue="received"><option value="received">Received</option><option value="adjust">Adjust (±)</option></Select>
              <Input name="delta" inputMode="numeric" placeholder="12" />
              <Input name="note" placeholder="PO #, count correction…" />
            </div>
            <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Update stock</SubmitButton>
          </ActionForm>
          {movements.length ? (
            <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto border-t border-stone-200 pt-2 text-xs text-stone-600">
              {movements.map((m) => <li key={m.id}>{fmt.format(m.createdAt)} · <span className={m.delta >= 0 ? "text-emerald-700" : "text-red-700"}>{m.delta > 0 ? "+" : ""}{m.delta}</span> · {m.reason}{m.note ? ` · ${m.note}` : ""}</li>)}
            </ul>
          ) : null}
        </Card>
      ) : null}
      <ActionForm action={updateProduct}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="productId" value={product.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={product.name} required placeholder="Moisture shampoo 250ml" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={product.categoryId} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={(product.priceCents / 100).toFixed(2)} required placeholder="24" /></Field>
          <Field label="SKU" name="sku"><Input name="sku" defaultValue={product.sku ?? ""} /></Field>
        </div>
        <Checkbox name="taxable" defaultChecked={product.taxable} label="Taxable" />
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Online store</legend>
          <Checkbox name="sellOnline" defaultChecked={product.sellOnline} label="Sell online (needs the store turned on under Settings → Online store)" />
          <Field label="Description" name="description" className="mt-2"><Textarea name="description" rows={4} defaultValue={product.description ?? ""} /></Field>
          <Field label="Photo" name="image" className="mt-2"><ImageField name="image" removeName="removeImage" current={product.imageUrl} /></Field>
        </fieldset>
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Inventory</legend>
          <Checkbox name="trackStock" defaultChecked={product.trackStock} label="Track stock (sales reduce the count; low-stock warning)" />
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Low-stock warning at" name="lowStockThreshold"><Input name="lowStockThreshold" type="number" min={0} defaultValue={product.lowStockThreshold} /></Field>
            <Field label="Cost per unit" name="cost" hint="For the stock value report."><Input name="cost" inputMode="decimal" defaultValue={product.costCents ? (product.costCents / 100).toFixed(2) : ""} placeholder="0" /></Field>
          </div>
        </fieldset>
        <SubmitButton pendingText="Saving…">Save product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
