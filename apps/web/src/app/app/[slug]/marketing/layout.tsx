import { headers } from "next/headers";
import { requireAction } from "@/lib/tenant";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can } from "@angelic/core";
import { PageHeader, Tabs } from "@/components/ui";

export default async function MarketingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = `/app/${slug}/marketing`;
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  // Automations live in their own sidebar section and are part of Business settings; Marketing (campaigns and promo codes) is "Send marketing".
  if (current.startsWith(`${base}/automations`)) {
    await requireAction(slug, "settings.business");
    return <>{children}</>;
  }
  const { permissions } = await requireAction(slug, "marketing.send");
  // A design open in the designer has the whole page: the designer is its own wide two-column builder.
  if (current.startsWith(`${base}/designs/`)) return <>{children}</>;
  const tab = current.startsWith(`${base}/promos`) ? `${base}/promos` : current.startsWith(`${base}/designs`) ? `${base}/designs` : base;
  return (
    <>
      <PageHeader title="Marketing" />
      {/* The other ways to bring clients back live elsewhere; this row makes Marketing the place to start. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          ...(can(permissions, "settings.business")
            ? [
                { href: `${base}/automations`, title: "Automations", blurb: "Reminders, win-backs and birthday notes that send themselves." },
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
      <Tabs items={[{ href: base, label: "Campaigns" }, { href: `${base}/designs`, label: "Email designs" }, { href: `${base}/promos`, label: "Promo codes" }]} current={tab} />
      {children}
    </>
  );
}
