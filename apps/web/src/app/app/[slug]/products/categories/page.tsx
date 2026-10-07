import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { BackLink, LinkButton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Product categories" };
import { CategoryList } from "@/components/categories";
import { moveCategoryAction, removeCategory, renameCategoryAction } from "../../categories-actions";

export default async function ProductCategoriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [categories, countRows] = await Promise.all([
    listCategories(business.id, "product"),
    withTenant(business.id, (tx) => tx.select({ id: schema.products.categoryId, n: sql<number>`count(*)` }).from(schema.products).where(eq(schema.products.active, true)).groupBy(schema.products.categoryId)),
  ]);
  const counts = Object.fromEntries(countRows.filter((r) => r.id).map((r) => [r.id!, Number(r.n)]));
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/products`}>Products</BackLink></div>
      <PageHeader title="Product categories">
        <LinkButton href={`/app/${slug}/products/categories/new`} variant="primary">+ New category</LinkButton>
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">This order is used in the product picker at checkout. Deleting a category leaves its products uncategorised.</p>
      <CategoryList slug={slug} kind="product" categories={categories} counts={counts} actions={{ rename: renameCategoryAction, remove: removeCategory, move: moveCategoryAction }} />
    </>
  );
}
