import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };

type Entry = { href: string; title: string; blurb: string; status?: string };

/** A short, grouped directory. Each page explains itself; this one just helps you find it. */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const locations = await withTenant(business.id, (tx) => tx.select({ id: schema.locations.id }).from(schema.locations).orderBy(asc(schema.locations.name)));
  const base = `/app/${slug}/settings`;
  const groups: { title: string; entries: Entry[] }[] = [
    {
      title: "Your business",
      entries: [
        { href: `${base}/profile`, title: "Business profile", blurb: "Name, timezone, logo, colours, about text and links." },
        { href: `${base}/locations`, title: "Locations", blurb: "Addresses, opening hours and tax rates.", status: locations.length === 1 ? "1 location" : `${locations.length} locations` },
        { href: `${base}/roles`, title: "Roles & permissions", blurb: "What each role can see and do." },
      ],
    },
    {
      title: "Online booking",
      entries: [
        { href: `${base}/booking`, title: "Booking rules", blurb: "Notice, cancellation window, reminders, deposits and no-show fee.", status: business.onlineBookingEnabled ? "on" : "off" },
        { href: `${base}/forms`, title: "Forms", blurb: "Intake questionnaires and waivers." },
        { href: `${base}/reviews`, title: "Reviews", blurb: "Rating requests and your Google review link." },
        { href: `${base}/loyalty`, title: "Loyalty & referrals", blurb: "Points, redemption value and referral bonuses.", status: business.loyaltyEnabled ? "on" : "off" },
        { href: `${base}/store`, title: "Online store", blurb: "Gift cards and products on your booking page.", status: business.storeEnabled ? "on" : business.giftCardsOnline ? "gift cards" : "off" },
        { href: `${base}/embed`, title: "Embed & buttons", blurb: "Put booking on your own website." },
        { href: `${base}/domain`, title: "Custom domain", blurb: "Serve the booking page from your hostname.", status: business.customDomain ?? undefined },
      ],
    },
    {
      title: "Payments & billing",
      entries: [
        { href: `${base}/payments`, title: "Card payments", blurb: "Your Stripe account for cards, deposits and saved cards.", status: business.stripeChargesEnabled ? "connected" : "not connected" },
        { href: `${base}/billing`, title: "Your plan", blurb: "Subscription, card on file and this month's usage." },
      ],
    },
    {
      title: "Messaging",
      entries: [
        { href: `${base}/messaging`, title: "Text number", blurb: "Your own toll-free number for confirmations and reminders." },
        { href: `${base}/notifications`, title: "Messages", blurb: "Text wording, replies from clients and the delivery log." },
      ],
    },
    {
      title: "Data",
      entries: [
        { href: `${base}/import`, title: "Import", blurb: "Bring clients, services and appointments from Vagaro." },
        { href: `${base}/audit`, title: "Activity log", blurb: "Who changed what, and when." },
      ],
    },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
            <Card>
              <ul className="divide-y divide-stone-100">
                {g.entries.map((e) => (
                  <li key={e.href}>
                    <Link href={e.href} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-stone-900">{e.title}</span>
                        <span className="block truncate text-xs text-stone-500">{e.blurb}</span>
                      </span>
                      {e.status ? <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{e.status}</span> : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
