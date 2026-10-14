import type { Metadata } from "next";
import { Shell } from "@/components";
import { DefaultsForm } from "@/price-forms";
import { getDefaultPriceBook } from "@/lib/pricing";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const book = await getDefaultPriceBook();
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Price book</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        What every business pays per month unless it has a custom price. Each business&apos;s estimate on the Tenants page is worked out from this and what it actually uses:
        locations, active staff, its text number and texts sent in the last 30 days. Set a custom price on a business&apos;s own page.
      </p>
      <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
        <DefaultsForm values={book} />
      </div>
      <p className="mt-3 max-w-2xl text-xs text-stone-500">
        These numbers drive the estimates here. Charging real cards from them needs the Stripe billing step, which is not built yet.
      </p>
    </Shell>
  );
}
