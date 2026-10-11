import { headers } from "next/headers";
import { requireAction } from "@/lib/tenant";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can } from "@angelic/core";
import { PageHeader, Tabs } from "@/components/ui";

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { permissions } = await requireAction(slug, "reports.view");
  const base = `/app/${slug}/marketing`;
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  // Automations live in their own sidebar section; Marketing is campaigns and promo codes.
  if (current.startsWith(`${base}/automations`)) return <>{children}</>;
  const tab = current.startsWith(`${base}/promos`) ? `${base}/promos` : base;
  return (
    <>
      <PageHeader title="Marketing" />
      {/* The other ways to bring clients back live elsewhere; this row makes Marketing the place to start. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { href: `${base}/automations`, title: "Automations", blurb: "Reminders, win-backs and birthday notes that send themselves." },
          ...(can(permissions, "business.manage")
            ? [
                { href: `/app/${slug}/settings/loyalty`, title: "Loyalty & referrals", blurb: "Points on every visit and a bonus for bringing a friend." },
                { href: `/app/${slug}/settings/reviews`, title: "Review requests", blurb: "Ask for a rating after each visit and link to Google." },
              ]
            : []),
        ].map((c) => (
          <Link key={c.href} href={c.href} className="rounded-xl border border-stone-200 bg-white px-4 py-3 transition-colors hover:bg-stone-50">
            <p className="flex items-center justify-between text-sm font-medium text-stone-800">{c.title} <ChevronRight className="h-4 w-4 text-stone-300" /></p>
            <p className="mt-0.5 text-xs text-stone-500">{c.blurb}</p>
          </Link>
        ))}
      </div>
      <Tabs items={[{ href: base, label: "Campaigns" }, { href: `${base}/promos`, label: "Promo codes" }]} current={tab} />
      {children}
    </>
  );
}
