import Link from "next/link";
import { CalendarDays, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings } from "lucide-react";
import { can } from "@angelic/core";
import { requireBusiness, listMyBusinesses } from "@/lib/tenant";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user, role } = await requireBusiness(slug);
  const mine = await listMyBusinesses(user.id);
  const base = `/app/${slug}`;
  type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
  const sections: { title: string; items: Item[] }[] = [
    { title: "Schedule", items: [
      { href: base, label: "Calendar", icon: CalendarDays, exact: true },
      { href: `${base}/waitlist`, label: "Waitlist", icon: ListOrdered },
      { href: `${base}/time`, label: "Time clock", icon: Clock },
    ] },
    { title: "People", items: [
      { href: `${base}/clients`, label: "Clients", icon: Users },
      { href: `${base}/staff`, label: "Staff", icon: UserCog },
    ] },
    { title: "Catalog", items: [
      { href: `${base}/services`, label: "Services", icon: Scissors },
      { href: `${base}/products`, label: "Products", icon: ShoppingBag },
      { href: `${base}/packages`, label: "Packages", icon: Package },
      { href: `${base}/memberships`, label: "Memberships", icon: BadgePercent },
      { href: `${base}/gift-cards`, label: "Gift cards", icon: Gift },
    ] },
    { title: "Money", items: [
      ...(can(role, "reports.view") ? [{ href: `${base}/reports`, label: "Sales", icon: BarChart3 } as Item] : []),
      ...(can(role, "payroll.view") ? [{ href: `${base}/payroll`, label: "Payroll", icon: Wallet } as Item] : []),
    ] },
    { title: "", items: can(role, "business.manage") ? [{ href: `${base}/settings`, label: "Settings", icon: Settings }] : [] },
  ].filter((s) => s.items.length > 0);
  const flat = sections.flatMap((s) => s.items);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="px-4 pb-3 pt-4">
          <Link href="/" aria-label="Home"><Wordmark /></Link>
          <p className="mt-2 truncate text-xs font-medium text-stone-500">{business.name}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-2">
          {sections.map((s, i) => (
            <div key={i}>
              {s.title ? <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{s.title}</p> : null}
              <div className="space-y-0.5">
                {s.items.map((n) => (
                  <NavLink key={n.href} href={n.href} exact={n.exact}>
                    <span className="flex items-center gap-2.5"><n.icon className="h-4 w-4 text-stone-400" />{n.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-2">
          <UserMenu user={user} businesses={mine} currentSlug={slug} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 overflow-x-auto border-b border-stone-200 bg-white px-3 py-2 md:hidden">
          {flat.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact}>{n.label}</NavLink>
          ))}
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
