import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { PermissionError, requireBusiness } from "@/lib/tenant";
import { canEditOwnStaff, canOpenStaffPage } from "@/lib/visibility";
import { BackLink, PageHeader, Tabs } from "@/components/ui";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; staffId: string }> }): Promise<Metadata> {
  const { slug, staffId } = await params;
  const { business, permissions, staffId: myStaffId } = await requireBusiness(slug);
  if (!canOpenStaffPage(permissions, myStaffId ?? null, staffId)) throw new PermissionError();
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  return { title: person ? `${person.displayName} · Staff` : "Staff" };
}

export default async function StaffDetailLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string; staffId: string }> }) {
  const { slug, staffId } = await params;
  // "Manage staff" opens everyone's page. A person with "Edit their own hours and time off" or "Edit their own services and prices" opens
  // their own page with just those tabs (S6).
  const { business, permissions, staffId: myStaffId } = await requireBusiness(slug);
  if (!canOpenStaffPage(permissions, myStaffId ?? null, staffId)) throw new PermissionError();
  const manage = can(permissions, "staff.manage");
  const hours = canEditOwnStaff(permissions, myStaffId ?? null, staffId, "hours");
  const services = canEditOwnStaff(permissions, myStaffId ?? null, staffId, "services");
  const person = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId) }));
  if (!person) notFound();
  const base = `/app/${slug}/staff/${staffId}`;
  const tabs = [
    ...(manage ? [{ href: base, label: "Profile" }] : []),
    ...(hours ? [{ href: `${base}/hours`, label: "Weekly hours" }, { href: `${base}/time-off`, label: "Time off" }] : []),
    ...(services ? [{ href: `${base}/services`, label: "Services" }] : []),
    ...(manage && can(permissions, "payroll.manage") ? [{ href: `${base}/pay`, label: "Pay" }] : []),
    ...(manage && can(permissions, "members.manage") ? [{ href: `${base}/access`, label: "Access" }] : []),
  ];
  const h = await headers();
  const current = h.get("x-pathname") ?? "";
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/staff`}>Staff</BackLink></div>
      <PageHeader title={person.displayName} />
      <Tabs items={tabs} current={current} />
      {children}
    </>
  );
}
