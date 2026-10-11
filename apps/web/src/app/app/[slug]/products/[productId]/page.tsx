import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Card, FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ProductFields } from "@/components/product-fields";
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
    <FormPage title={product.name} backHref={`/app/${slug}/products`} backLabel="Products">
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
        <ProductFields product={product} categories={categories} currency={business.currency} />
        <SubmitButton pendingText="Saving…">Save product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
