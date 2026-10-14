import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { listCategories } from "@/server/categories";
import { listSuppliers } from "@/server/inventory";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { ProductFields } from "@/components/product-fields";
import { createProduct } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string }> }) {
  const { slug } = await params;
  const { from } = await searchParams;
  const { business } = await requireAction(slug, "services.manage");
  const [categories, suppliers, source] = await Promise.all([
    listCategories(business.id, "product"),
    listSuppliers(business.id),
    from ? withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, from) })) : Promise.resolve(null),
  ]);
  // "Add another option": the same product, ready for its next size or shade (the code and the option are its own).
  const start = source ? { ...source, variantLabel: null, sku: null, barcode: null, imageUrl: source.imageUrl } : undefined;
  return (
    <FormPage title={source ? `New option of ${source.name}` : "New product"} backHref={`/app/${slug}/products`} backLabel="Products">
      <ActionForm action={createProduct}>
        <input type="hidden" name="slug" value={slug} />
        <ProductFields mode="new" product={start} categories={categories} suppliers={suppliers} currency={business.currency} />
        <SubmitButton pendingText="Saving…">Create product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
