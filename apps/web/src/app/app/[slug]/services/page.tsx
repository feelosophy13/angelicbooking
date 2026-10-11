import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, FolderPlus, List, Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { buildTree, subtreeIds } from "@/server/categories";
import { Empty, LinkButton, PageHeader } from "@/components/ui";
import { CategoryCard } from "@/components/categories";
import { moveCategoryAction } from "../categories-actions";
import { ServiceRows } from "./service-rows";
import { categoryMeta, loadServicesAdmin } from "./data";

export const metadata: Metadata = { title: "Services" };

/** The menu, browsed by category: tiles for each top-level category, then anything uncategorised. */
export default async function ServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const manage = can(permissions, "services.manage");
  const { services, categories, onlyAt } = await loadServicesAdmin(business.id);
  const tree = buildTree(categories);
  const countIn = (id: string) => { const ids = subtreeIds(categories, id); return services.filter((s) => s.active && s.categoryId && ids.includes(s.categoryId)).length; };
  const loose = services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId));
  const base = `/app/${slug}/services`;
  return (
    <>
      <PageHeader title="Services">
        <LinkButton href={`${base}/all`}><List className="h-4 w-4" /> All services</LinkButton>
        {manage ? <LinkButton href={`${base}/categories/new`}><FolderPlus className="h-4 w-4" /> New category</LinkButton> : null}
        {manage ? <LinkButton href={`${base}/new`} variant="primary"><Plus className="h-4 w-4" /> New service</LinkButton> : null}
      </PageHeader>
      {services.length === 0 && tree.length === 0 ? (
        <Empty title="No services yet" body="Your menu is what clients see when they book. Group services into categories such as Hair, Nails or Lashes; categories can hold sub-categories." action={{ href: `${base}/new`, label: "Add your first service" }} />
      ) : null}
      {tree.length ? (
        <section className="mb-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Categories</h2>
            {manage ? <Link href={`${base}/categories`} className="text-xs text-brand-700 hover:underline">Rename, reorder or delete</Link> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tree.map((c, i) => (
              <CategoryCard key={c.id} href={`${base}/categories/${c.id}`} name={c.name} imageUrl={c.imageUrl} description={c.description} meta={categoryMeta(countIn(c.id), c.children.length)}>
                {manage ? (
                  <>
                    <form action={moveCategoryAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="kind" value="service" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="up" /><button aria-label={`Move ${c.name} earlier`} disabled={i === 0} className="rounded-md border border-stone-200 bg-white/90 p-1 text-stone-500 shadow-sm hover:text-stone-900 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button></form>
                    <form action={moveCategoryAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="kind" value="service" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="down" /><button aria-label={`Move ${c.name} later`} disabled={i === tree.length - 1} className="rounded-md border border-stone-200 bg-white/90 p-1 text-stone-500 shadow-sm hover:text-stone-900 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button></form>
                  </>
                ) : null}
              </CategoryCard>
            ))}
          </div>
        </section>
      ) : null}
      {loose.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{tree.length ? "Uncategorised" : "Services"}</h2>
          <ServiceRows slug={slug} services={loose} currency={business.currency} manage={manage} onlyAt={onlyAt} />
          {manage && tree.length ? <p className="mt-2 text-xs text-stone-500">Open a service to put it in a category.</p> : null}
        </section>
      ) : null}
    </>
  );
}
