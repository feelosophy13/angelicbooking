import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarCheck, Gift, Globe, Instagram, MapPin, Phone, ShoppingBag, UserCircle } from "lucide-react";
import { getPublicBusiness, getPublicLocations, getPublicRating } from "@/server/public-booking";
import { appUrl } from "@/lib/stripe";
import { brandVars } from "@/lib/brand";
import { describeHours } from "@/lib/hours";
import { Stars } from "./ui";

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
  const [locations, rating] = await Promise.all([getPublicLocations(business.id), getPublicRating(business.id)]);
  const withHours = locations.filter((l) => l.hours);
  const base = `/book/${business.slug}`;
  const navLink = "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white/90 px-3 py-1.5 text-sm text-stone-700 shadow-sm backdrop-blur hover:bg-white";
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" style={brandVars(business.brandColor)}>
      {/* Hero: cover photo (or a brand gradient), logo, name, tagline, rating */}
      <header className="relative">
        <div className="relative h-44 w-full overflow-hidden bg-stone-200 sm:h-64">
          {business.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ background: "linear-gradient(120deg, var(--brand) 0%, var(--brand-dark) 60%, #1c1917 140%)" }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-stone-900/70 via-stone-900/10 to-transparent" aria-hidden />
        </div>
        <div className="absolute inset-x-0 top-0">
          <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-4 py-3">
            {business.storeEnabled ? <Link href={`${base}/shop`} className={navLink}><ShoppingBag className="h-4 w-4" /> Shop</Link> : business.giftCardsOnline ? <Link href={`${base}/gift`} className={navLink}><Gift className="h-4 w-4" /> Gift cards</Link> : null}
            {business.clientAccountsEnabled ? <Link href={`${base}/account`} className={navLink}><UserCircle className="h-4 w-4" /><span className="hidden sm:inline">My account</span></Link> : null}
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4">
          <div className="-mt-12 flex items-end gap-4 sm:-mt-14">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="" className="h-24 w-24 shrink-0 rounded-2xl border-4 border-stone-50 bg-white object-cover shadow-lg sm:h-28 sm:w-28" />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-4 border-stone-50 text-4xl font-semibold text-white shadow-lg sm:h-28 sm:w-28" style={{ background: "var(--brand)" }}>{business.name.slice(0, 1)}</div>
            )}
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{business.name}</h1>
              {business.tagline ? <p className="truncate text-sm text-stone-600 sm:text-base">{business.tagline}</p> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600 sm:text-sm">
            {rating.count > 0 ? <span className="flex items-center gap-1.5"><Stars value={rating.average} /><span className="font-medium text-stone-800">{rating.average.toFixed(1)}</span><span className="text-stone-400">({rating.count} review{rating.count === 1 ? "" : "s"})</span></span> : null}
            {business.addressLine ? <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-stone-400" />{business.addressLine}</span> : null}
            {business.phone ? <a href={`tel:${business.phone}`} className="flex items-center gap-1 hover:underline"><Phone className="h-3.5 w-3.5 text-stone-400" />{business.phone}</a> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <Link href={base} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800"><CalendarCheck className="h-3.5 w-3.5" /> Online booking</Link>
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-12 pt-4 text-sm text-stone-600">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          {business.about ? <p className="mb-4 whitespace-pre-line text-sm text-stone-700">{business.about}</p> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            {withHours.length ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Hours</p>
                {withHours.map((l) => (
                  <div key={l.id} className="mb-2 text-xs leading-5">{withHours.length > 1 ? <p className="font-medium text-stone-800">{l.name}</p> : null}{describeHours(l.hours).map((line) => <p key={line}>{line}</p>)}</div>
                ))}
              </div>
            ) : business.hoursText ? <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Hours</p><p className="whitespace-pre-line text-xs leading-5">{business.hoursText}</p></div> : null}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Find us</p>
              <div className="space-y-1.5 text-xs">
                {business.addressLine ? <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-stone-400" />{business.addressLine}</p> : null}
                {business.phone ? <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-stone-400" /><a href={`tel:${business.phone}`} className="hover:underline">{business.phone}</a></p> : null}
                {business.website ? <p className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-stone-400" /><a href={business.website} target="_blank" rel="noreferrer" className="hover:underline">{business.website.replace(/^https?:\/\//, "")}</a></p> : null}
                {business.instagram ? <p className="flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5 text-stone-400" /><a href={`https://instagram.com/${business.instagram}`} target="_blank" rel="noreferrer" className="hover:underline">@{business.instagram}</a></p> : null}
                {business.giftCardsOnline || business.storeEnabled ? <p className="flex items-center gap-1.5"><Gift className="h-3.5 w-3.5 text-stone-400" /><Link href={`${base}/gift`} className="hover:underline">Gift cards</Link>{business.storeEnabled ? <> · <Link href={`${base}/shop`} className="hover:underline">Shop</Link></> : null}</p> : null}
              </div>
            </div>
          </div>
        </div>
        <p className="pt-4 text-center text-xs text-stone-400">Online booking by Angelic Booking · <a href={appUrl("/privacy")} className="hover:text-stone-600">Privacy</a></p>
      </footer>
    </div>
  );
}
