import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";
import { brandVars } from "@/lib/brand";
import { PoweredBy } from "@/components/brand";
import { HeightReporter } from "./height-reporter";

export const metadata: Metadata = { robots: { index: false } };

/** Chromeless booking flow for iframes on the business's own website (see public/embed.js). */
export default async function EmbedLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  return (
    <div className="min-h-[200px] bg-white px-3 py-3 sm:px-4" style={brandVars(business.brandColor)}>
      <HeightReporter />
      {children}
      <p className="mt-6 text-center"><PoweredBy /></p>
    </div>
  );
}
