import Link from "next/link";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { SignOutButton } from "./sign-out";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user, role } = await requireBusiness(slug);
  const base = `/app/${slug}`;
  const sections: { title: string; items: { href: string; label: string; exact?: boolean }[] }[] = [
    {
      title: "Schedule",
      items: [
        { href: base, label: "Calendar", exact: true },
        { href: `${base}/waitlist`, label: "Waitlist" },
        { href: `${base}/time`, label: "Time clock" },
      ],
    },
    {
      title: "People",
      items: [
        { href: `${base}/clients`, label: "Clients" },
        { href: `${base}/staff`, label: "Staff" },
      ],
    },
    {
      title: "Catalog",
      items: [
        { href: `${base}/services`, label: "Services" },
        { href: `${base}/products`, label: "Products" },
        { href: `${base}/packages`, label: "Packages" },
        { href: `${base}/memberships`, label: "Memberships" },
        { href: `${base}/gift-cards`, label: "Gift cards" },
      ],
    },
    {
      title: "Money",
      items: [
        ...(can(role, "reports.view") ? [{ href: `${base}/reports`, label: "Sales" }] : []),
        ...(can(role, "payroll.view") ? [{ href: `${base}/payroll`, label: "Payroll" }] : []),
      ],
    },
    {
      title: "",
      items: can(role, "business.manage") ? [{ href: `${base}/settings`, label: "Settings" }] : [],
    },
  ].filter((s) => s.items.length > 0);
  const flat = sections.flatMap((s) => s.items);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="border-b border-stone-200 px-4 py-4">
          <Link href="/" className="block truncate font-semibold">{business.name}</Link>
          <p className="truncate text-xs text-stone-500">{user.name} · {role.replace("_", " ")}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {sections.map((s, i) => (
            <div key={i}>
              {s.title ? <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{s.title}</p> : null}
              <div className="space-y-0.5">
                {s.items.map((n) => (
                  <NavLink key={n.href} href={n.href} exact={n.exact}>{n.label}</NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-2">
          <SignOutButton />
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
