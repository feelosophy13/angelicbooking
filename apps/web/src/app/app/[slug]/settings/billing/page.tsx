import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { money } from "@/lib/format";
import { monthlyBill } from "@angelic/core/platform-pricing";
import { billableUsage, billingState, completeCheckout } from "@/server/billing";
import { priceBookFor } from "@/server/price-book";
import { listNumbers } from "@/server/messaging";
import { StatusBadge } from "@/components/status-badge";
import { BackLink, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { openPortalAction, refreshBillingAction, startBillingAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  let { business } = await requireAction(slug, "business.manage");
  let justSubscribed = false;
  if (sp.session_id) {
    await completeCheckout(business, sp.session_id).catch((e) => console.error("[billing] checkout sync failed", (e as Error).message));
    // requireAction is request-cached, so re-read the row to see what the sync wrote.
    business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, business.id) })) ?? business;
    justSubscribed = true;
  }
  const state = await billingState(business);
  const book = await priceBookFor(business.id);
  const numbers = await withTenant(business.id, listNumbers);
  const number = numbers.find((n) => !n.locationId) ?? numbers[0] ?? null;
  const numberFees = numbers.reduce((t, n) => t + n.monthlyFeeCents, 0);

  // Usage this billing period (or this calendar month before a subscription exists).
  const periodStart = business.currentPeriodEnd ? new Date(new Date(business.currentPeriodEnd).setMonth(business.currentPeriodEnd.getMonth() - 1)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [usage] = await withTenant(business.id, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.channel, "sms"), eq(schema.notifications.status, "sent"), gte(schema.notifications.sentAt, periodStart))),
  );
  const smsSent = Number(usage?.n ?? 0);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  const used = await billableUsage(business.id);
  // The same itemisation the platform admin sees. Text numbers are billed at what each number actually costs.
  const bill = monthlyBill({ ...used, hasNumber: false, smsLast30Days: smsSent }, book);
  const lines = state.comped ? [] : bill.lines.filter((l) => l.label !== "Base plan" || state.subscribed || book.baseCents === 0);
  const estimate = state.comped ? 0 : lines.reduce((t, l) => t + l.cents, 0) + numberFees;

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Billing" />
      {justSubscribed && state.subscribed ? <div className="mb-4"><Notice kind="success">Billing is set up. Thank you!</Notice></div> : null}
      {state.smsPausedReason ? <div className="mb-4"><Notice>{state.smsPausedReason} Until then no texts are sent to your clients; emails still go out.</Notice></div> : null}
      {state.delinquent ? (
        <div className="mb-4"><Notice>Your last payment failed. Update your card to keep text messaging and add-ons running.</Notice></div>
      ) : null}
      {!state.enabled ? <div className="mb-4"><Notice>Billing is not configured on this platform yet. Everything is free until it is.</Notice></div> : null}

      <div className="grid max-w-3xl gap-6">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-stone-500">Your plan</div>
              <div className="mt-1 text-2xl font-semibold">{state.comped ? "Complimentary" : book.baseCents > 0 ? `${money(book.baseCents)} / month` : "Free"}</div>
              <div className="mt-2 flex items-center gap-2">
                {state.status === "none" ? <span className="text-xs text-stone-500">{state.enabled ? "No card on file" : "Nothing to pay"}</span> : <StatusBadge status={state.status} />}
                {business.trialEndsAt && state.status === "trialing" ? <span className="text-xs text-stone-500">trial ends {fmt.format(business.trialEndsAt)}</span> : null}
                {business.currentPeriodEnd && state.subscribed ? <span className="text-xs text-stone-500">next invoice {fmt.format(business.currentPeriodEnd)}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {state.enabled && !state.subscribed && !state.comped ? (
                <ActionForm action={startBillingAction} className="inline">
                  <input type="hidden" name="slug" value={slug} />
                  <SubmitButton pendingText="Opening Stripe…">{book.baseCents > 0 ? "Start subscription" : "Add a card"}</SubmitButton>
                </ActionForm>
              ) : null}
              {state.enabled && business.stripeCustomerId ? (
                <ActionForm action={openPortalAction} className="inline">
                  <input type="hidden" name="slug" value={slug} />
                  <SubmitButton variant="secondary" pendingText="Opening…">Manage card &amp; invoices</SubmitButton>
                </ActionForm>
              ) : null}
              {state.enabled && business.stripeCustomerId ? (
                <ActionForm action={refreshBillingAction} className="inline">
                  <input type="hidden" name="slug" value={slug} />
                  <SubmitButton variant="ghost" pendingText="Refreshing…">Refresh</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-sm text-stone-600">
            {state.comped
              ? "This account is on us. Nothing is billed."
              : book.baseCents > 0
                ? `The plan covers booking, calendar, clients, checkout and payroll${book.includedLocations > 0 ? ` for ${book.includedLocations} location${book.includedLocations === 1 ? "" : "s"}` : ""}${book.includedStaff > 0 ? ` and ${book.includedStaff} active staff member${book.includedStaff === 1 ? "" : "s"}` : ""}. Anything beyond that and add-ons are billed on the same monthly invoice.`
                : "The booking platform is free. A card is only needed for paid add-ons such as a dedicated text number and text message usage, billed monthly."}
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="font-medium">This month</h2>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-stone-200">
              {lines.filter((l) => l.label !== "Text messages").map((l) => (
                <tr key={l.label}><td className="py-2">{l.label}<span className="block text-xs text-stone-500">{l.detail}</span></td><td className="py-2 text-right tabular-nums">{money(l.cents)}</td></tr>
              ))}
              <tr>
                <td className="py-2">
                  Dedicated text number{numbers.length > 1 ? ` × ${numbers.length}` : ""}{number ? <span className="block text-xs text-stone-500">{number.phoneNumber} · <StatusBadge status={number.status} /></span> : <span className="block text-xs text-stone-500">none · <Link href={`/app/${slug}/settings/messaging`} className="text-brand-700 underline">get one</Link></span>}
                </td>
                <td className="py-2 text-right tabular-nums">{money(numberFees)}</td>
              </tr>
              <tr>
                <td className="py-2">
                  Text messages sent since {fmt.format(periodStart)}
                  <span className="block text-xs text-stone-500">{smsSent} sent{book.smsIncluded > 0 ? `, ${book.smsIncluded} included` : ""}{book.smsUsageCents > 0 ? `, then ${money(book.smsUsageCents)} each` : ""}</span>
                </td>
                <td className="py-2 text-right tabular-nums">{money(state.comped ? 0 : (lines.find((l) => l.label === "Text messages")?.cents ?? 0))}</td>
              </tr>
              <tr className="font-medium"><td className="py-2">Estimated total</td><td className="py-2 text-right tabular-nums">{money(estimate)}</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">Estimate only; the invoice from Stripe is final. Card payments you take from clients are separate and go to your own Stripe account.</p>
        </Card>
      </div>
    </>
  );
}
