import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { CategoryPicker } from "@/components/categories";
import { updateProduct } from "../actions";

export default async function EditProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [product, categories] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.products.findFirst({ where: eq(schema.products.id, productId) })),
    listCategories(business.id, "product"),
  ]);
  if (!product) notFound();
  return (
    <>
      <PageHeader title={product.name}>
        <Link href={`/app/${slug}/products`} className="text-sm text-brand-700 underline">← Products</Link>
      </PageHeader>
      <Card className="max-w-xl p-4">
        <form action={updateProduct} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="productId" value={product.id} />
          <Field label="Name"><Input name="name" defaultValue={product.name} required /></Field>
          <Field label="Category"><CategoryPicker name="categoryId" categories={categories} value={product.categoryId} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price"><Input name="price" inputMode="decimal" defaultValue={(product.priceCents / 100).toFixed(2)} required /></Field>
            <Field label="SKU"><Input name="sku" defaultValue={product.sku ?? ""} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked={product.taxable} className="h-4 w-4 accent-brand-600" /> Taxable</label>
          <Button type="submit">Save product</Button>
        </form>
      </Card>
    </>
  );
}
