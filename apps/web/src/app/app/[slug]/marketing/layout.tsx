import { headers } from "next/headers";
import { requireAction } from "@/lib/tenant";
import Link from "next/link";
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
      <PageHeader title="Marketing">
        <p className="text-xs text-stone-500">
          Also: <Link href={`${base}/automations`} className="text-brand-700 hover:underline">Automations</Link>
          {can(permissions, "business.manage") ? <> · <Link href={`/app/${slug}/settings/loyalty`} className="text-brand-700 hover:underline">Loyalty &amp; referrals</Link> · <Link href={`/app/${slug}/settings/reviews`} className="text-brand-700 hover:underline">Review requests</Link></> : null}
        </p>
      </PageHeader>
      <Tabs items={[{ href: base, label: "Campaigns" }, { href: `${base}/promos`, label: "Promo codes" }]} current={tab} />
      {children}
    </>
  );
}
