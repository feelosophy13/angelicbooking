import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveClock } from "@/server/time-clock";
import { brandVars } from "@/lib/brand";
import { Kiosk } from "./kiosk";

export const metadata: Metadata = { title: "Clock in", robots: { index: false, follow: false } };

/** Public clock-in page behind the QR code posted at a location. */
export default async function ClockPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const kiosk = await resolveClock(token);
  if (!kiosk) notFound();
  const { business, location } = kiosk;
  return (
    <div className="flex min-h-screen flex-col items-center bg-stone-50 px-4 py-8" style={brandVars(business.brandColor)}>
      <div className="mb-6 text-center">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt="" className="mx-auto mb-2 h-14 w-14 rounded-xl border border-stone-200 bg-white object-cover" />
        ) : null}
        <h1 className="text-xl font-semibold">{business.name}</h1>
        <p className="text-sm text-stone-500">{location.name} · Time clock</p>
      </div>
      <Kiosk token={token} />
      <p className="mt-8 max-w-xs text-center text-xs text-stone-400">No PIN yet? Ask a manager: it is set on your staff profile.</p>
    </div>
  );
}
