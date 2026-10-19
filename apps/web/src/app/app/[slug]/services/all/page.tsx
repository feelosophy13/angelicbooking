import type { Metadata } from "next";
import { CreditCard, Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { canSeePrices } from "@/lib/visibility";
import { buildTree, flattenTree, pathTo } from "@/server/categories";
import { BackLink, Empty, LinkButton, PageHeader } from "@/components/ui";
import { ServiceRows } from "../service-rows";
import { loadServicesAdmin } from "../data";

export const metadata: Metadata = { title: "All services" };

/** Every service on one page, grouped by category path (Hair › Colour). */
export default async function AllServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "catalog.view");
  const manage = can(permissions, "services.manage");
  const prices = canSeePrices(permissions);
  const { services, categories, onlyAt } = await loadServicesAdmin(business.id);
  const ordered = flattenTree(buildTree(categories));
  const groups = ordered.map((c) => ({ id: c.id, title: pathTo(categories, c.id).map((p) => p.name).join(" › "), list: services.filter((s) => s.categoryId === c.id) })).filter((g) => g.list.length);
  const loose = services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId));
  const base = `/app/${slug}/services`;
  return (
    <>
      <div className="mb-2"><BackLink href={base}>Services</BackLink></div>
      <PageHeader title="All services">
        {manage && services.length ? <LinkButton href={`${base}/payments`}><CreditCard className="h-4 w-4" /> Online payments</LinkButton> : null}
        {manage ? <LinkButton href={`${base}/new`} variant="primary"><Plus className="h-4 w-4" /> New service</LinkButton> : null}
      </PageHeader>
      <div className="space-y-4">
        {services.length === 0 ? <Empty title="No services yet" body="Your menu is what clients see when they book." action={{ href: `${base}/new`, label: "Add your first service" }} /> : null}
        {groups.map((g) => <ServiceRows key={g.id} slug={slug} title={g.title} titleHref={`${base}/categories/${g.id}`} services={g.list} currency={business.currency} manage={manage} onlyAt={onlyAt} prices={prices} />)}
        {loose.length ? <ServiceRows slug={slug} title="Uncategorised" services={loose} currency={business.currency} manage={manage} onlyAt={onlyAt} prices={prices} /> : null}
      </div>
    </>
  );
}
