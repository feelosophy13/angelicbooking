import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { isStripeConfigured } from "@/lib/stripe";
import { buildTree, flattenTree, pathTo } from "@/server/categories";
import { formatMoney } from "@/lib/utils";
import { depositLabel } from "@/server/online-payments";
import { Card, FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { OnlinePaymentField } from "@/components/online-payment-field";
import { loadServicesAdmin } from "../data";
import { applyOnlinePayment } from "./actions";
import { SelectAll } from "./select-all";

export const metadata: Metadata = { title: "Online payments" };

/** Tick services, choose what booking them online collects, apply once. */
export default async function BulkPaymentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const { services, categories } = await loadServicesAdmin(business.id);
  const money = (c: number) => formatMoney(c, business.currency);
  const groups = [
    ...flattenTree(buildTree(categories)).map((c) => ({ id: c.id, title: pathTo(categories, c.id).map((p) => p.name).join(" › "), list: services.filter((s) => s.categoryId === c.id) })),
    { id: "loose", title: "Uncategorised", list: services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId)) },
  ].filter((g) => g.list.length);
  return (
    <FormPage title="Online payments" backHref={`/app/${slug}/services/all`} backLabel="All services" width="max-w-3xl">
      <p className="mb-4 text-sm text-stone-600">Tick the services, choose what booking them online collects up front, and apply it once.</p>
      <ActionForm action={applyOnlinePayment}>
        <input type="hidden" name="slug" value={slug} />
        <OnlinePaymentField type="flat" depositCents={0} percent={0} currency={business.currency} stripeReady={isStripeConfigured() && business.stripeChargesEnabled} slug={slug} />
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.id}>
              <div className="mb-1 flex items-center gap-2 border-b border-stone-200 pb-1">
                <SelectAll group={g.id} label={`Select every service in ${g.title}`} />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
              </div>
              <ul className="divide-y divide-stone-100">
                {g.list.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2 text-sm hover:bg-stone-50">
                      <input type="checkbox" name="id" value={s.id} data-group={g.id} className="h-4 w-4" />
                      <span className={s.active ? "min-w-0 flex-1 truncate font-medium" : "min-w-0 flex-1 truncate text-stone-400 line-through"}>{s.name}</span>
                      <span className="w-24 shrink-0 text-right tabular-nums text-stone-600">{money(s.priceCents)}</span>
                      <span className="w-36 shrink-0 text-right text-xs text-stone-500">{depositLabel(s, money) ?? "Nothing up front"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <SubmitButton pendingText="Applying…">Apply to ticked services</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
