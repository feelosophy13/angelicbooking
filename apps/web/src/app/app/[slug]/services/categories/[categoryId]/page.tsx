import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, FolderPlus, Pencil, Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { buildTree, pathTo, subtreeIds } from "@/server/categories";
import { BackLink, LinkButton, PageHeader } from "@/components/ui";
import { CategoryCard, CategoryThumb } from "@/components/categories";
import { moveCategoryAction } from "../../../categories-actions";
import { ServiceRows } from "../../service-rows";
import { categoryMeta, loadServicesAdmin } from "../../data";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; categoryId: string }> }): Promise<Metadata> {
  const { slug, categoryId } = await params;
  const { business } = await requireBusiness(slug);
  const { categories } = await loadServicesAdmin(business.id);
  const c = categories.find((x) => x.id === categoryId);
  return { title: c ? `${c.name} · Services` : "Services" };
}

/** One category: its sub-categories as tiles, then its services. */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string; categoryId: string }> }) {
  const { slug, categoryId } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const manage = can(permissions, "services.manage");
  const { services, categories, onlyAt } = await loadServicesAdmin(business.id);
  const me = categories.find((c) => c.id === categoryId);
  if (!me) notFound();
  const node = buildTree(categories.filter((c) => subtreeIds(categories, me.id).includes(c.id)))[0]!;
  const crumbs = pathTo(categories, me.parentId);
  const countIn = (id: string) => { const ids = subtreeIds(categories, id); return services.filter((s) => s.active && s.categoryId && ids.includes(s.categoryId)).length; };
  const mine = services.filter((s) => s.categoryId === me.id);
  const base = `/app/${slug}/services`;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm text-stone-600">
        <BackLink href={base}>Services</BackLink>
        {crumbs.map((c) => <span key={c.id} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-stone-300" /><Link href={`${base}/categories/${c.id}`} className="hover:text-stone-900">{c.name}</Link></span>)}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <CategoryThumb imageUrl={me.imageUrl} name={me.name} className="h-20 w-20 rounded-xl text-2xl sm:h-24 sm:w-24" />
        <div className="min-w-0 flex-1">
          <PageHeader title={me.name}>
            {manage ? <LinkButton href={`${base}/categories/${me.id}/edit`} size="sm"><Pencil className="h-4 w-4" /> Edit category</LinkButton> : null}
            {manage ? <LinkButton href={`${base}/categories/new?parent=${me.id}`} size="sm"><FolderPlus className="h-4 w-4" /> Sub-category</LinkButton> : null}
            {manage ? <LinkButton href={`${base}/new?category=${me.id}`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New service</LinkButton> : null}
          </PageHeader>
          <p className="-mt-4 text-sm text-stone-500">{categoryMeta(countIn(me.id), node.children.length)}{me.description ? ` · ${me.description}` : ""}</p>
        </div>
      </div>
      {node.children.length ? (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Sub-categories</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {node.children.map((c, i) => (
              <CategoryCard key={c.id} href={`${base}/categories/${c.id}`} name={c.name} imageUrl={c.imageUrl} description={c.description} meta={categoryMeta(countIn(c.id), c.children.length)}>
                {manage ? (
                  <>
                    <form action={moveCategoryAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="kind" value="service" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="up" /><button aria-label={`Move ${c.name} earlier`} disabled={i === 0} className="rounded-md border border-stone-200 bg-white/90 p-1 text-stone-500 shadow-sm hover:text-stone-900 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button></form>
                    <form action={moveCategoryAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="kind" value="service" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="dir" value="down" /><button aria-label={`Move ${c.name} later`} disabled={i === node.children.length - 1} className="rounded-md border border-stone-200 bg-white/90 p-1 text-stone-500 shadow-sm hover:text-stone-900 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button></form>
                  </>
                ) : null}
              </CategoryCard>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Services{node.children.length ? ` in ${me.name}` : ""}</h2>
        <ServiceRows slug={slug} services={mine} currency={business.currency} manage={manage} onlyAt={onlyAt} emptyText={node.children.length ? "No services directly in this category; browse the sub-categories above." : "No services here yet."} />
      </section>
    </>
  );
}
