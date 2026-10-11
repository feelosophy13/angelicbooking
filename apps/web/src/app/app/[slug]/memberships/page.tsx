import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { can, isMembershipInterval, periodLabel, periodNoun } from "@angelic/core";

export const metadata: Metadata = { title: "Membership plans" };
import { requireBusiness } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { listLocations } from "@/server/locations";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { togglePlan } from "../catalog-actions";

export default async function MembershipsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const { plans, services } = await getOffersCatalog(business.id);
  const locations = await listLocations(business.id);
  const validAtLabel = (ids: string[]) => (ids.length ? ` · valid at ${ids.map((id) => locations.find((l) => l.id === id)?.name.replace(/^.*? - /, "") ?? "?").join(", ")} only` : "");
  const manage = can(permissions, "services.manage");
  const svc = (id: string | null) => services.find((s) => s.id === id)?.name ?? "—";
  const iv = (x: string) => (isMembershipInterval(x) ? x : "month");
  return (
    <>
      <PageHeader title="Membership plans">
        {manage ? <LinkButton href={`/app/${slug}/memberships/new`} variant="primary"><Plus className="h-4 w-4" /> New plan</LinkButton> : null}
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">Plans sold at checkout, billed weekly, monthly or yearly. Each includes sessions of a service and/or a discount. Members with a saved card renew automatically; others renew when you sell the plan again.</p>
      {plans.length === 0 ? <Empty title="No plans yet" /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {plans.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${manage ? rowClass : ""}`}>
                <div className={`min-w-0 flex-1 ${p.active ? "" : "text-stone-400 line-through"}`}>
                  <p className="font-medium">{manage ? <RowLink href={`/app/${slug}/memberships/${p.id}`}>{p.name}</RowLink> : p.name}</p>
                  <p className="text-xs text-stone-500">{[
                    p.includedSessions ? `${p.includedSessions}× ${svc(p.includedServiceId)} ${periodLabel(iv(p.interval), p.intervalCount)}` : "",
                    p.rolloverCap ? `up to ${p.rolloverCap} carr${p.rolloverCap === 1 ? "ies" : "y"} over` : "",
                    p.discountBps ? `${p.discountBps / 100}% off other services` : "",
                    p.cycleCount ? `ends after ${p.cycleCount} period${p.cycleCount === 1 ? "" : "s"}` : "",
                    p.description ?? "",
                  ].filter(Boolean).join(" · ")}{validAtLabel(p.validLocationIds)}</p>
                </div>
                <span className="w-32 shrink-0 text-right font-medium tabular-nums">{formatMoney(p.priceCents, business.currency)} <span className="font-normal text-stone-500">/ {periodNoun(iv(p.interval), p.intervalCount)}</span></span>
                {manage ? <form action={togglePlan} className={rowControl}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
