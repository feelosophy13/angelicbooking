import Link from "next/link";
import { CalendarDays, CalendarCheck, CalendarClock, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, GraduationCap, Star, Megaphone, ExternalLink, Receipt, Workflow, FileText, Heart, Images, ShieldCheck, Boxes, MessageSquare, KeyRound, Inbox } from "lucide-react";
import { can } from "@angelic/core";
import { isDelinquent } from "@/lib/billing-config";
import { requireBusiness, listMyBusinesses } from "@/lib/tenant";
import { and, asc, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { permissionsForRole, listRoles } from "@/server/roles";
import { appUrl } from "@/lib/stripe";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { ResendVerification } from "@/components/resend-verification";
import { ownerEmailVerified } from "@/server/access";
import { DevViewAs } from "@/components/dev-view-as";
import { viewAsEnabled } from "@/lib/dev-view-as";
import { CommandPalette } from "@/components/command-palette";
import { NavHistory } from "@/components/nav-history";
import { navSections } from "@/lib/nav";
import { unreadCount } from "@/server/inbound";
import { UnreadBadge } from "./unread-badge";
import { NavLink } from "./nav-link";
import { lowStockCount } from "@/server/inventory";
import { MobileNav, type NavSection } from "./mobile-nav";
import { NewMenu, type NewItem } from "./new-menu";
import { blockingAccess, bookingAccess } from "@/lib/appointment-access";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = { CalendarDays, CalendarCheck, CalendarClock, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, GraduationCap, Star, Megaphone, Receipt, Workflow, FileText, Heart, Images, ShieldCheck, Boxes, MessageSquare, KeyRound, Inbox };

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, user, role, permissions, viewingAs, realRole, staffId, plan } = await requireBusiness(slug);
  const [mine, roles, locations] = await Promise.all([listMyBusinesses(user.id), listRoles(business.id), withTenant(business.id, (tx) => tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)))]);
  void permissionsForRole;
  const lowCount = can(permissions, "inventory.manage") ? await lowStockCount(business.id) : 0;
  const unreadTexts = can(permissions, "clients.messages") ? await unreadCount(business.id) : 0;
  // Development only: the staff a Provider can be viewed as.
  const viewAsStaff = viewAsEnabled() ? await withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName))) : [];
  const roleName = roles.find((r) => r.key === role)?.name ?? role.replace("_", " ");
  const base = `/app/${slug}`;
  // What clients see: the public booking page (custom domain when one is set). Opens in a new tab.
  const bookingUrl = business.customDomain ? `https://${business.customDomain}` : appUrl(`/book/${business.slug}`);
  // "+ New": what can be started from any page, in the sidebar and at the top of the phone menu.
  const newItems: NewItem[] = [
    ...(bookingAccess(permissions, staffId ?? null) ? [{ href: `${base}/appointments/new`, label: "Appointment", hint: "Book a client in", icon: "appointment" as const }] : []),
    ...(can(permissions, "checkout.take") ? [{ href: `${base}/sales/new`, label: "Sale", hint: "Products, gift cards, a walk-in", icon: "sale" as const }] : []),
    ...(can(permissions, "clients.write") ? [{ href: `${base}/clients/new`, label: "Client", hint: "Add to your client list", icon: "client" as const }] : []),
    ...(blockingAccess(permissions, staffId ?? null) ? [{ href: `${base}/appointments/block`, label: "Blocked time", hint: "Lunch, a meeting, time away", icon: "block" as const }] : []),
  ];
  const quickActions = newItems.length ? <NewMenu items={newItems} /> : null;
  type Item = { href: string; label: string; iconName: string; exact?: boolean };
  const it = (href: string, label: string, iconName: string, exact?: boolean): Item => ({ href, label, iconName, exact });
  // Sidebar sections, the Settings directory and ⌘K share one definition: lib/nav.ts.
  // The inbox count keeps itself current (a new text shows without a reload); other badges change on navigation.
  const sections = navSections(base, permissions).map((s) => ({ ...s, items: s.items.map((n) => (n.href === `${base}/inbox` ? { ...n, badge: <UnreadBadge slug={slug} initial={unreadTexts} /> } : n)) }));
  const tabs: Item[] = [
    it(base, "Calendar", "CalendarDays", true),
    ...(can(permissions, "clients.read") ? [it(`${base}/clients`, "Clients", "Users")] : []),
    can(permissions, "checkout.take") ? it(`${base}/sales`, "Checkout", "Receipt") : can(permissions, "reports.view") ? it(`${base}/reports`, "Reports", "BarChart3") : it(`${base}/time`, "Time", "Clock"),
    it(`${base}/staff`, "Staff", "UserCog"),
  ];

  // Trial over, no subscription: no sidebar, just the page they are allowed to open (billing, or the locked notice).
  if (plan.state === "expired") {
    return (
      <div className="min-h-screen">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <Link href="/" aria-label="Home"><Wordmark /></Link>
          <div className="w-56"><UserMenu user={user} businesses={mine} currentSlug={slug} /></div>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    );
  }
  const owner = can(permissions, "business.manage");
  const awaitingVerification = owner && business.publishRequiresVerified && !(await ownerEmailVerified(business.id));
  return (
    <div className="flex min-h-screen">
      <NavHistory />
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-white md:flex print:hidden">
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
        {quickActions ? <div className="px-3 pb-2">{quickActions}</div> : null}
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
                  const I = ICON[n.iconName] ?? CalendarDays;
                  return (
                    <NavLink key={n.href} href={n.href} exact={n.exact} exclude={n.exclude}>
                      <span className="flex items-center gap-2.5"><I className="h-4 w-4 text-stone-400" />{n.label}{"badge" in n ? n.badge : null}{n.href === `${base}/inventory` && lowCount ? <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800" title={`${lowCount} product${lowCount === 1 ? "" : "s"} low, out or off`}>{lowCount}</span> : null}</span>
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
        <MobileNav sections={sections as NavSection[]} businessName={business.name} userName={`${user.name} · ${roleName}`} tabs={tabs} bookingUrl={bookingUrl} quick={quickActions}>
          <UserMenu user={user} businesses={mine} currentSlug={slug} />
        </MobileNav>
        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          {isDelinquent(business.subscriptionStatus) ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              Your last payment failed.{" "}
              {can(permissions, "billing.manage") ? <Link href={`${base}/settings/billing`} className="underline">Update your card</Link> : "Ask the owner to update the card"} to keep text messaging running.
            </div>
          ) : null}
          {awaitingVerification ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Verify your email to publish your booking page and send messages. We emailed {user.email}.{" "}
              <ResendVerification email={user.email} callbackURL={`/app/${slug}`} />
            </div>
          ) : null}
          {plan.state === "trial" && can(permissions, "billing.manage") ? (
            <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${plan.daysLeft <= 3 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-brand-100 bg-brand-50/60 text-brand-900"}`}>
              Free trial: {plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"} left. <Link href={`${base}/settings/billing`} className="underline">Add a card</Link> so nothing stops when it ends; you won&apos;t be charged until then.
            </div>
          ) : null}
          {children}
        </main>
      </div>
      {viewAsEnabled() && (realRole ?? role) === "owner" ? (
        <DevViewAs
          roles={roles.map((r) => ({ key: r.key, name: r.name, needsStaff: !(r.permissions as string[]).includes("appointments.read.any") && (r.permissions as string[]).includes("appointments.read.own") }))}
          staff={viewAsStaff}
          realRole={realRole ?? role}
          current={viewingAs ? (roles.find((r) => r.key === viewingAs && !(r.permissions as string[]).includes("appointments.read.any") && (r.permissions as string[]).includes("appointments.read.own")) ? `${viewingAs}:${staffId ?? ""}` : viewingAs) : null}
        />
      ) : null}
    </div>
  );
}
