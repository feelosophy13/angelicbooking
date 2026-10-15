import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components";
import { listTenantsWithBills } from "@/lib/tenants";
import { money } from "@/lib/price-form";
import { DefaultsForm } from "@/price-forms";
import { getDefaultPriceBook } from "@/lib/pricing";
import { Card, PageHeader, Stat } from "@/ui/kit";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [book, { tenants }] = await Promise.all([getDefaultPriceBook(), listTenantsWithBills()]);
  const custom = tenants.filter((t) => t.hasOverrides).length;
  const comped = tenants.filter((t) => t.comped).length;
  const total = tenants.reduce((s, t) => s + t.bill.totalCents, 0);
  const extraStaff = tenants.reduce((s, t) => s + Math.max(0, t.activeStaff - t.price.includedStaff), 0);
  const extraLocations = tenants.reduce((s, t) => s + Math.max(0, t.locations - t.price.includedLocations), 0);
  return (
    <Shell>
      <PageHeader title="Pricing" subtitle="What every business pays unless it has its own deal. Give one business a different price on its Billing tab." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estimated monthly" value={money(total)} hint="If everyone paid" />
        <Stat label="Own deal" value={custom} hint="Businesses with a custom price" />
        <Stat label="Comped" value={comped} hint="Never charged" />
        <Stat label="Over their plan" value={extraStaff + extraLocations} hint={`${extraStaff} extra staff · ${extraLocations} extra locations`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card title="Default prices"><DefaultsForm values={book} /></Card>
          <Card title="Businesses with their own deal" aside={custom ? `${custom}` : undefined} pad={false}>
            {custom === 0 ? (
              <div className="p-4 text-sm text-ink-3">Nobody yet. Open a business and use its Billing tab to give it a different price.</div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {tenants.filter((t) => t.hasOverrides).map((t) => (
                  <li key={t.id} className="relative flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <Link href={`/tenants/${t.id}?tab=billing`} className="min-w-0 truncate font-medium after:absolute after:inset-0">{t.name}</Link>
                    <span className="tabular-nums text-ink-2">{money(t.bill.totalCents)} / month</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="How it works">
          <ul className="list-disc space-y-2 pl-4 text-sm text-ink-2">
            <li>Each business&apos;s estimate comes from these prices and what it uses: locations, active staff, its text number and texts over the last 30 days.</li>
            <li>New subscriptions are built from it. The daily sweep keeps quantities in line with locations and staff.</li>
            <li>Changing the defaults does <strong>not</strong> re-price existing subscribers; a custom price does.</li>
            <li>Whole cents only: 0.02 means 2¢ a text.</li>
            <li>The platform fee is a percent of each card payment a business takes from its clients, on top of its subscription.</li>
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
