import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { updateProduct } from "../actions";

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
  return (
    <FormPage title={product.name} backHref={`/app/${slug}/products`} backLabel="Products" width="max-w-xl">
      <ActionForm action={updateProduct}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="productId" value={product.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={product.name} required placeholder="Moisture shampoo 250ml" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={product.categoryId} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={(product.priceCents / 100).toFixed(2)} required placeholder="24" /></Field>
          <Field label="SKU" name="sku"><Input name="sku" defaultValue={product.sku ?? ""} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked={product.taxable} className="h-4 w-4 accent-brand-600" /> Taxable</label>
        <SubmitButton pendingText="Saving…">Save product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
