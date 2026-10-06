import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select, Empty } from "@/components/ui";
import { createPackage, createPlan, issueGiftCard, togglePackage, togglePlan } from "./actions";

export default async function OffersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const { packages, plans, services, giftCards } = await getOffersCatalog(business.id);
  const money = (c: number) => formatMoney(c, business.currency);
  const manage = can(role, "services.manage");
  const svcName = (id: string | null) => services.find((s) => s.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Packages, memberships & gift cards" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Packages</h2>
          <p className="mb-3 text-xs text-stone-500">Prepaid sessions of one service. Sold at checkout; sessions are redeemed on future visits.</p>
          {packages.length === 0 ? <Empty title="No packages yet" /> : (
            <ul className="mb-4 divide-y divide-stone-100 text-sm">
              {packages.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className={p.active ? "" : "text-stone-400 line-through"}>{p.name} · {p.sessions}× {svcName(p.serviceId)} · {money(p.priceCents)}{p.validDays ? ` · ${p.validDays} days` : ""}</span>
                  {manage ? <form action={togglePackage}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
                </li>
              ))}
            </ul>
          )}
          {manage ? (
            <form action={createPackage} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><Input name="name" required placeholder="5 Lash Fills" /></Field>
              <Field label="Service"><Select name="serviceId" required>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Sessions"><Input name="sessions" type="number" min={1} defaultValue={5} required /></Field>
              <Field label="Price"><Input name="price" inputMode="decimal" required placeholder="275" /></Field>
              <Field label="Valid for (days, optional)"><Input name="validDays" type="number" min={1} placeholder="365" /></Field>
              <div className="flex items-end"><Button type="submit" variant="secondary">Add package</Button></div>
            </form>
          ) : null}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-medium">Membership plans</h2>
          <p className="mb-3 text-xs text-stone-500">Monthly plan sold at checkout (renewed by selling it again). Includes N sessions of a service per month and/or a discount. Automatic card billing arrives with Stripe subscriptions.</p>
          {plans.length === 0 ? <Empty title="No plans yet" /> : (
            <ul className="mb-4 divide-y divide-stone-100 text-sm">
              {plans.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className={p.active ? "" : "text-stone-400 line-through"}>{p.name} · {money(p.priceCents)}/mo{p.includedSessions ? ` · ${p.includedSessions}× ${svcName(p.includedServiceId)}` : ""}{p.discountBps ? ` · ${p.discountBps / 100}% off services` : ""}</span>
                  {manage ? <form action={togglePlan}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button></form> : null}
                </li>
              ))}
            </ul>
          )}
          {manage ? (
            <form action={createPlan} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><Input name="name" required placeholder="Lash Club" /></Field>
              <Field label="Monthly price"><Input name="price" inputMode="decimal" required placeholder="99" /></Field>
              <Field label="Included service"><Select name="includedServiceId"><option value="">None</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Sessions per month"><Input name="includedSessions" type="number" min={0} defaultValue={1} /></Field>
              <Field label="Discount on other services (%)"><Input name="discountPct" type="number" min={0} max={100} defaultValue={0} /></Field>
              <div className="flex items-end"><Button type="submit" variant="secondary">Add plan</Button></div>
            </form>
          ) : null}
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-2 font-medium">Gift cards</h2>
          <p className="mb-3 text-xs text-stone-500">Sold at checkout (a code is issued when the sale is paid) or issued here. Redeemed as a payment method at checkout.</p>
          {can(role, "checkout.take") ? (
            <form action={issueGiftCard} className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Amount"><Input name="amount" inputMode="decimal" required placeholder="50" className="w-32" /></Field>
              <Field label="Recipient (optional)"><Input name="recipientName" placeholder="Name" className="w-56" /></Field>
              <Button type="submit" variant="secondary">Issue gift card</Button>
            </form>
          ) : null}
          {giftCards.length === 0 ? <Empty title="No gift cards yet" /> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-2 py-1">Code</th><th className="px-2 py-1">Recipient</th><th className="px-2 py-1 text-right">Initial</th><th className="px-2 py-1 text-right">Balance</th><th className="px-2 py-1">Issued</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {giftCards.map((g) => (
                  <tr key={g.id} className={g.balanceCents === 0 ? "text-stone-400" : ""}>
                    <td className="px-2 py-1 font-mono">{g.code}</td><td className="px-2 py-1">{g.recipientName ?? ""}</td><td className="px-2 py-1 text-right">{money(g.initialCents)}</td><td className="px-2 py-1 text-right font-medium">{money(g.balanceCents)}</td><td className="px-2 py-1 text-stone-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(g.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
