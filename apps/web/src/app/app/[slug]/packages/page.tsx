import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";

export const metadata: Metadata = { title: "Packages" };
import { requireBusiness } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { togglePackage } from "../catalog-actions";

export default async function PackagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const { packages, services } = await getOffersCatalog(business.id);
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
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className={p.active ? "" : "text-stone-400 line-through"}>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-stone-500">{p.sessions}× {svc(p.serviceId)}{p.validDays ? ` · valid ${p.validDays} days` : ""}</p>
                </div>
                <span className="font-medium">{formatMoney(p.priceCents, business.currency)}</span>
                {manage ? <form action={togglePackage}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
