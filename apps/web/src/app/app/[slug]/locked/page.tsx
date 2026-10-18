import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Free trial ended" };

/** Where a business lands when its free trial is over and it has no subscription. Billing is the only other page that opens, for whoever holds "billing.manage". */
export default async function LockedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const owner = can(permissions, "billing.manage");
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">Your free trial has ended</h1>
      <p className="mt-3 text-sm text-stone-600">
        {business.name}&apos;s calendar, clients and sales are safe. To keep using Angelic Booking, start a subscription.
        Until then your online booking page is closed and no messages go out.
      </p>
      {owner ? (
        <div className="mt-6"><LinkButton href={`/app/${slug}/settings/billing`}>Choose a plan</LinkButton></div>
      ) : (
        <p className="mt-6 text-sm text-stone-600">Ask the owner of {business.name} to start the subscription.</p>
      )}
      <p className="mt-8 text-xs text-stone-400"><Link href="/" className="underline">Switch business</Link></p>
    </div>
  );
}
