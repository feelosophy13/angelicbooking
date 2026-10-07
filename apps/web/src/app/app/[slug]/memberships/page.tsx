import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { togglePlan } from "../catalog-actions";

export default async function MembershipsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const { plans, services } = await getOffersCatalog(business.id);
  const manage = can(role, "services.manage");
  const svc = (id: string | null) => services.find((s) => s.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Membership plans">
        {manage ? <LinkButton href={`/app/${slug}/memberships/new`} variant="primary">+ New plan</LinkButton> : null}
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">Monthly plans sold at checkout and renewed by selling them again. Each includes sessions of a service and/or a discount. Automatic card billing arrives with Stripe subscriptions.</p>
      {plans.length === 0 ? <Empty title="No plans yet" /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {plans.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className={p.active ? "" : "text-stone-400 line-through"}>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-stone-500">{p.includedSessions ? `${p.includedSessions}× ${svc(p.includedServiceId)} per month` : ""}{p.includedSessions && p.discountBps ? " · " : ""}{p.discountBps ? `${p.discountBps / 100}% off other services` : ""}{p.description ? ` · ${p.description}` : ""}</p>
                </div>
                <span className="font-medium">{formatMoney(p.priceCents, business.currency)}/mo</span>
                {manage ? <form action={togglePlan}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
