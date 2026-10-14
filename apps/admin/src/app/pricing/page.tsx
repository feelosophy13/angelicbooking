import type { Metadata } from "next";
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
      <PageHeader title="Price book" subtitle="What every business pays per month unless it has a custom price. Set a custom price on a business's Billing tab." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estimated monthly" value={money(total)} hint="If everyone paid" />
        <Stat label="Custom prices" value={custom} hint="Businesses with their own deal" />
        <Stat label="Comped" value={comped} hint="Never charged" />
        <Stat label="Extra seats" value={extraStaff + extraLocations} hint={`${extraStaff} staff · ${extraLocations} locations beyond the plan`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Default prices"><DefaultsForm values={book} /></Card>
        <Card title="How it works">
          <ul className="list-disc space-y-2 pl-4 text-sm text-ink-2">
            <li>Each business&apos;s estimate comes from this book and what it uses: locations, active staff, its text number and texts over the last 30 days.</li>
            <li>New subscriptions are built from it. The daily sweep keeps quantities in line with locations and staff.</li>
            <li>Changing the defaults does <strong>not</strong> re-price existing subscribers; a custom price does.</li>
            <li>Whole cents only: 0.02 means 2¢ a text.</li>
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
