import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBusinessForLinks } from "@/server/public-booking";
import { verifyUnsubscribe } from "@/lib/unsubscribe";
import { UnsubscribeForm } from "@/app/book/[slug]/unsubscribe/[token]/form";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/** The unsubscribe link in marketing emails. Outside the booking site so it works even while online booking is turned off. */
export default async function UnsubscribePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getBusinessForLinks(slug);
  if (!business) notFound();
  const valid = verifyUnsubscribe(business, token) !== null;
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-4 text-center text-lg font-semibold">{business.name}</h1>
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">
        {valid ? <UnsubscribeForm slug={slug} token={token} businessName={business.name} /> : <>That link isn&apos;t valid. Contact {business.name} to update your preferences.</>}
      </div>
    </main>
  );
}
