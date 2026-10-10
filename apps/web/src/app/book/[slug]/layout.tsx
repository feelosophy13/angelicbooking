import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gift, Globe, Instagram, MapPin, Phone, ShoppingBag, UserCircle } from "lucide-react";
import { getPublicBusiness } from "@/server/public-booking";
import { appUrl } from "@/lib/stripe";
import { brandVars } from "@/lib/brand";
import { describeHours } from "@/lib/hours";
import { getPublicLocations } from "@/server/public-booking";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getPublicBusiness(slug);
  if (!b) return { title: "Book online" };
  const title = `Book online · ${b.name}`;
  const description = b.tagline ?? `Book an appointment at ${b.name} online.`;
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, url: appUrl(`/book/${b.slug}`), siteName: b.name, type: "website", images: b.coverUrl ? [{ url: b.coverUrl }] : b.logoUrl ? [{ url: b.logoUrl }] : [] },
    twitter: { card: b.coverUrl ? "summary_large_image" : "summary", title, description },
    robots: { index: b.onlineBookingEnabled, follow: true },
  };
}

export default async function BookLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  const locations = await getPublicLocations(business.id);
  const withHours = locations.filter((l) => l.hours);
  return (
    <div className="min-h-screen bg-stone-50" style={brandVars(business.brandColor)}>
      {business.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <div className="h-40 w-full bg-stone-200 sm:h-56"><img src={business.coverUrl} alt="" className="h-full w-full object-cover" /></div>
      ) : null}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-4">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logoUrl} alt="" className={`h-14 w-14 rounded-xl border border-stone-200 bg-white object-cover ${business.coverUrl ? "-mt-10 shadow" : ""}`} />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-semibold text-white" style={{ background: "var(--brand)" }}>{business.name.slice(0, 1)}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{business.name}</p>
            {business.tagline ? <p className="truncate text-sm text-stone-600">{business.tagline}</p> : business.addressLine ? <p className="truncate text-xs text-stone-500">{business.addressLine}</p> : null}
          </div>
          {business.phone ? <a href={`tel:${business.phone}`} className="hidden items-center gap-1 text-sm sm:inline-flex" style={{ color: "var(--brand)" }}><Phone className="h-4 w-4" />{business.phone}</a> : null}
          {business.storeEnabled ? <Link href={`/book/${business.slug}/shop`} className="hidden items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 sm:inline-flex"><ShoppingBag className="h-4 w-4" /> Shop</Link> : business.giftCardsOnline ? <Link href={`/book/${business.slug}/gift`} className="hidden items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 sm:inline-flex"><Gift className="h-4 w-4" /> Gift cards</Link> : null}
          {business.clientAccountsEnabled ? <Link href={`/book/${business.slug}/account`} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50"><UserCircle className="h-4 w-4" /><span className="hidden sm:inline">My account</span></Link> : null}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-2xl space-y-4 px-4 pb-10 pt-4 text-sm text-stone-600">
        {business.about ? <p className="whitespace-pre-line">{business.about}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {withHours.length ? (
            <div>
              <p className="mb-1 font-medium text-stone-800">Hours</p>
              {withHours.map((l) => (
                <div key={l.id} className="mb-2 text-xs">{withHours.length > 1 ? <p className="font-medium text-stone-700">{l.name}</p> : null}{describeHours(l.hours).map((line) => <p key={line}>{line}</p>)}</div>
              ))}
            </div>
          ) : business.hoursText ? <div><p className="mb-1 font-medium text-stone-800">Hours</p><p className="whitespace-pre-line text-xs">{business.hoursText}</p></div> : null}
          <div className="space-y-1 text-xs">
            {business.addressLine ? <p className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{business.addressLine}</p> : null}
            {business.phone ? <p className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><a href={`tel:${business.phone}`}>{business.phone}</a></p> : null}
            {business.website ? <p className="flex items-center gap-1"><Globe className="h-3.5 w-3.5" /><a href={business.website} target="_blank" rel="noreferrer" className="underline">{business.website.replace(/^https?:\/\//, "")}</a></p> : null}
            {business.instagram ? <p className="flex items-center gap-1"><Instagram className="h-3.5 w-3.5" /><a href={`https://instagram.com/${business.instagram}`} target="_blank" rel="noreferrer" className="underline">@{business.instagram}</a></p> : null}
          </div>
        </div>
        {business.giftCardsOnline || business.storeEnabled ? <p className="text-center text-xs"><Link href={`/book/${business.slug}/gift`} className="underline">Gift cards</Link>{business.storeEnabled ? <> · <Link href={`/book/${business.slug}/shop`} className="underline">Shop</Link></> : null}</p> : null}
        <p className="pt-2 text-center text-xs text-stone-400">Online booking by Angelic Booking · <a href={appUrl("/privacy")} className="hover:text-stone-600">Privacy</a></p>
      </footer>
    </div>
  );
}
