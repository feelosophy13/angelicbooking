import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { dateShort } from "@/lib/format";
import { monthStartIn, previewBreakdown, priceBookBreakdown, pricingOverrides, type Breakdown } from "@/lib/billing-breakdown";
import { billingState, completeCheckout, localBillingUsage } from "@/server/billing";
import { listInvoices, stripeOverview } from "@/server/billing-overview";
import { priceBookDetailFor } from "@/server/price-book";
import { listNumbers } from "@/server/messaging";
import { listLocations } from "@/server/locations";
import { StatusBadge } from "@/components/status-badge";
import { BackLink, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { InvoicesCard } from "./invoices-card";
import { refreshBillingAction, startBillingAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ session_id?: string; after?: string; before?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireAction(slug, "billing.manage");
  let { business } = ctx;
  const plan = ctx.plan;
  let justSubscribed = false;
  if (sp.session_id) {
    await completeCheckout(business, sp.session_id).catch((e) => console.error("[billing] checkout sync failed", (e as Error).message));
    // requireAction is request-cached, so re-read the row to see what the sync wrote.
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, business.id) })) ?? business;
    justSubscribed = true;
  }
  const currency = business.currency;
  const tz = business.timezone;
  const date = (d: Date) => dateShort(d, tz);

  const [state, pricing, numbers, locations] = await Promise.all([billingState(business), priceBookDetailFor(business.id), withTenant(business.id, listNumbers), listLocations(business.id)]);
  const book = pricing.book;
  // Stripe only when it can be charged: a business without a subscription has nothing there yet.
  const [overview, invoices] = state.enabled ? await Promise.all([stripeOverview(business), listInvoices(business, { after: sp.after, before: sp.before })]) : [{ reachable: true, subscription: null, preview: null }, { rows: [], olderAfter: null, newerBefore: null, reachable: true }];
  const sub = overview.subscription;

  // The usage window: Stripe's current period, else this calendar month (in the business's timezone) while on trial.
  const periodStart = sub?.periodStart ?? monthStartIn(tz);
  const usage = await localBillingUsage(business.id, periodStart);
  const fromStripe = !!overview.preview;
  const breakdown: Breakdown = fromStripe ? previewBreakdown(overview.preview!, book, usage, currency) : priceBookBreakdown(book, usage, currency);
  const stripeDown = state.enabled && !!business.stripeSubscriptionId && !overview.reachable;
  const overrides = pricingOverrides(pricing.platform, pricing.overrides, currency);
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "Unknown location") : locations.length > 1 ? "All locations" : null);

  // When the next charge happens, worded for the state the business is in.
  const trialEnd = sub?.trialEnd ?? (plan.state === "trial" ? plan.endsAt : null);
  const periodEnd = sub?.periodEnd ?? business.currentPeriodEnd;
  const whenNext = state.comped
    ? null
    : sub?.cancelAt
      ? `Plan ends ${date(sub.cancelAt)}; nothing more is charged.`
      : sub?.status === "trialing" && trialEnd
        ? `Free trial until ${date(trialEnd)}. First charge on ${date(trialEnd)}.`
        : sub && periodEnd
          ? `Billing period ${sub.periodStart ? `${date(sub.periodStart)} – ` : "until "}${date(periodEnd)}. Next charge on ${date(periodEnd)}.`
          : plan.state === "trial"
            ? `Free trial until ${date(plan.endsAt)}. Nothing is charged until then, and only once a card is on file.`
            : plan.state === "expired"
              ? `Your free trial ended${plan.endedAt ? ` on ${date(plan.endedAt)}` : ""}. Start the subscription to continue.`
              : business.currentPeriodEnd
                ? `Next charge on ${date(business.currentPeriodEnd)}.`
                : null;

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Billing">
        {state.enabled && !state.subscribed && !state.comped ? (
          <ActionForm action={startBillingAction} className="inline">
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton pendingText="Opening Stripe…">{book.baseCents > 0 ? "Start subscription" : "Add a card"}</SubmitButton>
          </ActionForm>
        ) : null}
        {state.enabled && business.stripeCustomerId ? (
          <ActionForm action={refreshBillingAction} className="inline">
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton variant="ghost" pendingText="Refreshing…">Refresh</SubmitButton>
          </ActionForm>
        ) : null}
      </PageHeader>
      {justSubscribed && state.subscribed ? <div className="mb-4"><Notice kind="success">Billing is set up. Thank you!</Notice></div> : null}
      {plan.state === "expired" ? <div className="mb-4"><Notice>Your free trial has ended. Start your subscription to reopen your calendar and booking page. Your data is safe.</Notice></div> : null}
      {state.smsPausedReason ? <div className="mb-4"><Notice>{state.smsPausedReason} Until then no texts are sent to your clients; emails still go out.</Notice></div> : null}
      {state.delinquent ? <div className="mb-4"><Notice>Your last payment failed. Update your card under Invoices to keep text messaging and add-ons running.</Notice></div> : null}
      {!state.enabled ? <div className="mb-4"><Notice kind="info">Billing is not configured on this platform yet. Everything is free until it is.</Notice></div> : null}
      {stripeDown ? <div className="mb-4"><Notice kind="info">Stripe could not be reached just now, so the figures below come from your price book and today&apos;s counts. Refresh in a minute for the amounts Stripe will charge.</Notice></div> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">This month</h2>
              <p className="mt-1 text-sm text-stone-600">{whenNext ?? (state.comped ? "This account is on us. Nothing is billed." : "Nothing is scheduled.")}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">{state.comped ? "Complimentary" : formatMoney(breakdown.totalCents, currency)}</div>
              <div className="mt-1 flex items-center justify-end gap-2 text-xs text-stone-500">
                {state.comped ? null : sub?.card ? <span>{sub.card.brand.replace(/^\w/, (c) => c.toUpperCase())} •••• {sub.card.last4}</span> : state.status === "none" ? <span>{state.enabled ? "No card on file" : "Nothing to pay"}</span> : null}
                {state.status !== "none" ? <StatusBadge status={sub?.status ?? state.status} /> : null}
              </div>
            </div>
          </div>
          {state.comped ? null : (
            <table className="mt-4 w-full text-sm">
              <tbody className="divide-y divide-stone-200">
                {breakdown.lines.map((l, i) => (
                  <tr key={`${l.kind}-${i}`}>
                    <td className="py-2 pr-3">
                      {l.label}
                      <span className="block text-xs text-stone-500">{l.detail}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.kind === "base" && l.cents === 0 ? "Free" : formatMoney(l.cents, currency)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2 pr-3">{fromStripe ? "Projected total" : "Estimated total"}<span className="block text-xs font-normal text-stone-500">{breakdown.usageCents > 0 ? "texts are added as they are sent" : "texts over the allowance are added as they are sent"}</span></td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(breakdown.totalCents, currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-stone-500">
            {state.comped
              ? "Card payments you take from clients are separate and go to your own Stripe account."
              : fromStripe
                ? "From Stripe's preview of your next invoice; the invoice is final. Card payments you take from clients are separate and go to your own Stripe account."
                : "From your price book and today's staff, locations and texts; the invoice from Stripe is final. Card payments you take from clients are separate and go to your own Stripe account."}
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="font-medium">Add-ons</h2>
          <div className="mt-3 divide-y divide-stone-200 text-sm">
            <div className="py-3 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">Dedicated text number</span>
                <span className="shrink-0 tabular-nums text-stone-600">{book.numberCents > 0 ? `${formatMoney(book.numberCents, currency)} / month` : "included"}</span>
              </div>
              {numbers.length ? (
                <ul className="mt-2 space-y-2">
                  {numbers.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{n.phoneNumber}</span>
                      <StatusBadge status={n.status} />
                      {locName(n.locationId) ? <span className="text-xs text-stone-500">{locName(n.locationId)}</span> : null}
                      {n.monthlyFeeCents !== book.numberCents ? <span className="text-xs text-stone-500">{formatMoney(n.monthlyFeeCents, currency)} / month</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-stone-500">None yet. Confirmations and reminders are texted from your own toll-free number{book.smsIncluded > 0 ? `, with ${book.smsIncluded} texts a month included` : ""}{book.smsUsageCents > 0 ? ` then ${formatMoney(book.smsUsageCents, currency)} each` : ""}.</p>
              )}
              <p className="mt-2 text-xs"><Link href={`/app/${slug}/settings/messaging`} className="text-brand-700 underline">Settings → Text messaging</Link></p>
            </div>
            {overrides.length ? (
              <div className="py-3">
                <div className="font-medium">Your pricing</div>
                <p className="mt-1 text-xs text-stone-500">Set for your business by Angelic Booking; everything else is at the standard price.</p>
                <ul className="mt-2 space-y-1">
                  {overrides.map((o) => (
                    <li key={o.field} className="flex items-start justify-between gap-3">
                      <span>{o.label}<span className="block text-xs text-stone-500">standard {o.standard}</span></span>
                      <span className="shrink-0 tabular-nums">{o.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <InvoicesCard slug={slug} page={invoices} hasCustomer={!!business.stripeCustomerId} portalEnabled={state.enabled} timezone={tz} email={business.email} />
      </div>
    </>
  );
}
