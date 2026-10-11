import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";

export const metadata: Metadata = { robots: { index: false, follow: false } };
import { verifyUnsubscribe } from "@/server/marketing";
import { UnsubscribeForm } from "./form";

export default async function UnsubscribePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  const valid = verifyUnsubscribe(business, token) !== null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">
      {valid ? <UnsubscribeForm slug={slug} token={token} businessName={business.name} /> : <>That link isn&apos;t valid. Contact {business.name} to update your preferences.</>}
    </div>
  );
}
