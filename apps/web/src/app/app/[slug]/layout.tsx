import Link from "next/link";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { SignOutButton } from "./sign-out";
import { NavLink } from "./nav-link";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { business, user, role } = await requireBusiness(slug);
  const base = `/app/${slug}`;
  const nav = [
    { href: base, label: "Calendar" },
    { href: `${base}/clients`, label: "Clients" },
    { href: `${base}/services`, label: "Services" },
    { href: `${base}/staff`, label: "Staff" },
    ...(can(role, "business.manage") ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white md:flex">
        <div className="border-b border-stone-200 px-4 py-4">
          <Link href="/" className="block truncate font-semibold">{business.name}</Link>
          <p className="truncate text-xs text-stone-500">{user.name} · {role.replace("_", " ")}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.href === base}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="border-t border-stone-200 p-2">
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 overflow-x-auto border-b border-stone-200 bg-white px-3 py-2 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.href === base}>{n.label}</NavLink>
          ))}
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
