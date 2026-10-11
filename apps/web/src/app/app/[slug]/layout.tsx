import Link from "next/link";
import { CalendarDays, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, GraduationCap, Star, Megaphone, ExternalLink, Receipt, Workflow } from "lucide-react";
import { can } from "@angelic/core";
import { isDelinquent } from "@/lib/billing-config";
import { requireBusiness, listMyBusinesses } from "@/lib/tenant";
import { asc, desc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { permissionsForRole, listRoles } from "@/server/roles";
import { appUrl } from "@/lib/stripe";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette } from "@/components/command-palette";
import { NavLink } from "./nav-link";
import { MobileNav, type NavSection } from "./mobile-nav";

const ICON = { CalendarDays, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, GraduationCap, Star, Megaphone, Receipt, Workflow } as const;
type IconName = keyof typeof ICON;

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user, role, permissions } = await requireBusiness(slug);
  const [mine, roles, locations] = await Promise.all([listMyBusinesses(user.id), listRoles(business.id), withTenant(business.id, (tx) => tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)))]);
  void permissionsForRole;
  const roleName = roles.find((r) => r.key === role)?.name ?? role.replace("_", " ");
  const base = `/app/${slug}`;
  // What clients see: the public booking page (custom domain when one is set). Opens in a new tab.
  const bookingUrl = business.customDomain ? `https://${business.customDomain}` : appUrl(`/book/${business.slug}`);
  type Item = { href: string; label: string; iconName: IconName; exact?: boolean };
  const it = (href: string, label: string, iconName: IconName, exact?: boolean): Item => ({ href, label, iconName, exact });
  const sections: { title: string; items: Item[] }[] = [
    { title: "Schedule", items: [
      it(base, "Calendar", "CalendarDays", true),
      it(`${base}/classes`, "Classes", "GraduationCap"),
      it(`${base}/waitlist`, "Waitlist", "ListOrdered"),
      it(`${base}/time`, "Time clock", "Clock"),
    ] },
    { title: "People", items: [
      it(`${base}/clients`, "Clients", "Users"),
      it(`${base}/reviews`, "Reviews", "Star"),
      it(`${base}/staff`, "Staff", "UserCog"),
    ] },
    { title: "Catalog", items: [
      it(`${base}/services`, "Services", "Scissors"),
      it(`${base}/products`, "Products", "ShoppingBag"),
      it(`${base}/packages`, "Packages", "Package"),
      it(`${base}/memberships`, "Memberships", "BadgePercent"),
      it(`${base}/gift-cards`, "Gift cards", "Gift"),
    ] },
    { title: "Money", items: [
      ...(can(permissions, "checkout.take") ? [it(`${base}/sales`, "Sales", "Receipt")] : []),
      ...(can(permissions, "reports.view") ? [it(`${base}/reports`, "Reports", "BarChart3"), it(`${base}/marketing`, "Marketing", "Megaphone")] : []),
      ...(can(permissions, "payroll.view") ? [it(`${base}/payroll`, "Payroll", "Wallet")] : []),
    ] },
    { title: "Automation", items: can(permissions, "reports.view") ? [it(`${base}/marketing/automations`, "Automations", "Workflow")] : [] },
    { title: "", items: can(permissions, "business.manage") ? [it(`${base}/settings`, "Settings", "Settings")] : [] },
  ].filter((s) => s.items.length > 0);
  const tabs: Item[] = [
    it(base, "Calendar", "CalendarDays", true),
    it(`${base}/clients`, "Clients", "Users"),
    can(permissions, "checkout.take") ? it(`${base}/sales`, "Sales", "Receipt") : can(permissions, "reports.view") ? it(`${base}/reports`, "Reports", "BarChart3") : it(`${base}/time`, "Time", "Clock"),
    it(`${base}/staff`, "Staff", "UserCog"),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="px-4 pb-3 pt-4">
          <Link href="/" aria-label="Home"><Wordmark /></Link>
          <p className="mt-2 truncate text-xs font-medium text-stone-500">{business.name} · {roleName}</p>
          {locations.length > 1 ? (
            <p className="mt-0.5 truncate text-[11px] text-stone-400" title={locations.map((l) => l.name).join(", ")}>
              {can(permissions, "business.manage") ? <Link href={`${base}/settings/locations`} className="hover:text-stone-600">{locations.length} locations · {locations.map((l) => l.name.replace(`${business.name} - `, "")).join(", ")}</Link> : `${locations.length} locations · ${locations.map((l) => l.name.replace(`${business.name} - `, "")).join(", ")}`}
            </p>
          ) : null}
        </div>
        <div className="px-3 pb-2"><CommandPalette slug={slug} /></div>
        <div className="px-3 pb-3">
          <a href={bookingUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100" title={bookingUrl}>
            <ExternalLink className="h-4 w-4" /> Open booking page
          </a>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-2">
          {sections.map((s, i) => (
            <div key={i}>
              {s.title ? <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{s.title}</p> : null}
              <div className="space-y-0.5">
                {s.items.map((n) => {
                  const I = ICON[n.iconName];
                  return (
                    <NavLink key={n.href} href={n.href} exact={n.exact}>
                      <span className="flex items-center gap-2.5"><I className="h-4 w-4 text-stone-400" />{n.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-2">
          <UserMenu user={user} businesses={mine} currentSlug={slug} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav sections={sections as NavSection[]} businessName={business.name} userName={`${user.name} · ${roleName}`} tabs={tabs} bookingUrl={bookingUrl}>
          <UserMenu user={user} businesses={mine} currentSlug={slug} />
        </MobileNav>
        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          {isDelinquent(business.subscriptionStatus) ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Your last payment failed.{" "}
              {can(permissions, "business.manage") ? <Link href={`${base}/settings/billing`} className="underline">Update your card</Link> : "Ask the owner to update the card"} to keep text messaging running.
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
