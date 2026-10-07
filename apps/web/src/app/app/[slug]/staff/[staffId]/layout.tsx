import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { PageHeader, Tabs } from "@/components/ui";

export default async function StaffDetailLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  const { business, role } = await requireAction(slug, "staff.manage");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  const base = `/app/${slug}/staff/${staffId}`;
  const tabs = [
    { href: base, label: "Profile" },
    { href: `${base}/hours`, label: "Weekly hours" },
    { href: `${base}/time-off`, label: "Time off" },
    { href: `${base}/services`, label: "Services" },
    ...(can(role, "members.manage") ? [{ href: `${base}/pay`, label: "Pay" }] : []),
  ];
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  return (
    <>
      <PageHeader title={person.displayName}>
        <Link href={`/app/${slug}/staff`} className="text-sm text-brand-700 underline">← Staff</Link>
      </PageHeader>
      <Tabs items={tabs} current={current} />
      {children}
    </>
  );
}
