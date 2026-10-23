import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { resolveCheckin } from "@/server/checkin-kiosk";
import { brandVars } from "@/lib/brand";
import { Kiosk } from "./kiosk";

export const metadata: Metadata = { title: "Check in", robots: { index: false, follow: false } };
// A tablet on a stand: no pinch zoom or double-tap zoom to get stuck in between clients.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

/** The client self check-in kiosk for one location (Settings → Check-in kiosk). No staff login on the device. */
export default async function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const kiosk = await resolveCheckin(token);
  if (!kiosk) notFound();
  const { business, location } = kiosk;
  const site = location.name.replace(`${business.name} - `, "");
  return (
    <div className="flex min-h-dvh select-none flex-col justify-center bg-stone-50 px-4 py-6 sm:px-8" style={brandVars(business.brandColor)}>
      <header className="mb-6 text-center">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt="" width={80} height={80} className="mx-auto mb-3 h-16 w-16 rounded-2xl border border-stone-200 bg-white object-cover sm:h-20 sm:w-20" />
        ) : null}
        <h1 className="text-2xl font-semibold text-stone-900 sm:text-3xl">{business.name}</h1>
        {site && site !== business.name ? <p className="mt-1 text-base text-stone-500">{site}</p> : null}
      </header>
      <main className="flex flex-col items-center">
        <Kiosk token={token} />
      </main>
    </div>
  );
}
