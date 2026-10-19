import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";

export const metadata: Metadata = { title: "Packages" };
import { requireAction } from "@/lib/tenant";
import { canSeePrices } from "@/lib/visibility";
import { getOffersCatalog } from "@/server/offers";
import { listLocations } from "@/server/locations";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { Thumb } from "@/components/thumb";
import { togglePackage } from "../catalog-actions";

export default async function PackagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "catalog.view");
  const prices = canSeePrices(permissions);
  const { packages, services } = await getOffersCatalog(business.id);
  const locations = await listLocations(business.id);
  const validAtLabel = (ids: string[]) => (ids.length ? ` · valid at ${ids.map((id) => locations.find((l) => l.id === id)?.name.replace(/^.*? - /, "") ?? "?").join(", ")} only` : "");
  const manage = can(permissions, "services.manage");
  const svc = (id: string) => services.find((s) => s.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Packages">
        {manage ? <LinkButton href={`/app/${slug}/packages/new`} variant="primary"><Plus className="h-4 w-4" /> New package</LinkButton> : null}
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">Prepaid sessions of one service. Sold at checkout; sessions are redeemed on later visits.</p>
      {packages.length === 0 ? <Empty title="No packages yet" /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {packages.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${manage ? rowClass : ""}`}>
                <Thumb src={p.imageUrl} />
                <div className={`min-w-0 flex-1 ${p.active ? "" : "text-stone-400 line-through"}`}>
                  <p className="font-medium">{manage ? <RowLink href={`/app/${slug}/packages/${p.id}`}>{p.name}</RowLink> : p.name}</p>
                  <p className="text-xs text-stone-500">{p.sessions}× {p.serviceId ? svc(p.serviceId) : "any service"}{p.validDays ? ` · valid ${p.validDays} days` : ""}{p.description ? ` · ${p.description}` : ""}{validAtLabel(p.validLocationIds)}</p>
                </div>
                {prices ? <span className="w-28 shrink-0 text-right font-medium tabular-nums">{formatMoney(p.priceCents, business.currency)}</span> : null}
                {manage ? <form action={togglePackage} className={rowControl}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
