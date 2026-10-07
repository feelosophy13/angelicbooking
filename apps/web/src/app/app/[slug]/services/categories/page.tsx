import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { BackLink, LinkButton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Service categories" };
import { CategoryList } from "@/components/categories";
import { moveCategoryAction, removeCategory, renameCategoryAction } from "../../categories-actions";

export default async function ServiceCategoriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [categories, countRows] = await Promise.all([
    listCategories(business.id, "service"),
    withTenant(business.id, (tx) => tx.select({ id: schema.services.categoryId, n: sql<number>`count(*)` }).from(schema.services).where(eq(schema.services.active, true)).groupBy(schema.services.categoryId)),
  ]);
  const counts = Object.fromEntries(countRows.filter((r) => r.id).map((r) => [r.id!, Number(r.n)]));
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/services`}>Services</BackLink></div>
      <PageHeader title="Service categories">
        <LinkButton href={`/app/${slug}/services/categories/new`} variant="primary">+ New category</LinkButton>
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">This order is used on the booking page and in service lists. Deleting a category leaves its services uncategorised.</p>
      <CategoryList slug={slug} kind="service" categories={categories} counts={counts} actions={{ rename: renameCategoryAction, remove: removeCategory, move: moveCategoryAction }} />
    </>
  );
}
