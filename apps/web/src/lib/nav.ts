import { can, type Action, type Permissions } from "@angelic/core";
import { blockingAccess, bookingAccess } from "./appointment-access";
import { canOpenGiftCards, canOpenSales, canSeeReviews } from "./visibility";

/**
 * The dashboard's navigation, in one place: the sidebar sections, the Settings directory and the ⌘K page
 * list are all derived from here so a page added to one is findable from the others.
 */

export type NavItem = { href: string; label: string; iconName: string; exact?: boolean; /** Paths that should not light this item up (another item owns them). */ exclude?: string[] };
export type NavSectionDef = { title: string; items: NavItem[] };

type Perms = Parameters<typeof can>[0];

/**
 * The permissions that open the Settings directory: each Settings page is gated by one of these, and the directory lists the entries the
 * viewer may open. "settings.business" is the business's setup and "settings.booking" its booking, store and client-care rules; the rest were split out (2026-10-18) so an owner can hand over the
 * settings without the money (billing.manage: Stripe, subscription), the keys (integrations.manage: API keys, text number) or the log.
 */
export const SETTINGS_ACTIONS: readonly Action[] = ["settings.business", "settings.booking", "forms.manage", "billing.manage", "integrations.manage", "audit.view", "members.manage"];
export const canOpenSettings = (permissions: Perms) => SETTINGS_ACTIONS.some((a) => can(permissions, a));

/** Settings → Payments for a viewer who may open it, else null (pages then say "ask the owner" instead of linking). */
export const paymentsHrefFor = (slug: string, permissions: Perms): string | null => (can(permissions, "billing.manage") ? `/app/${slug}/settings/payments` : null);

const it = (href: string, label: string, iconName: string, extra?: { exact?: boolean; exclude?: string[] }): NavItem => ({ href, label, iconName, ...extra });

export function navSections(base: string, permissions: Perms): NavSectionDef[] {
  const ok = (a: Action) => can(permissions, a);
  return [
    { title: "Schedule", items: [
      it(base, "Calendar", "CalendarDays", { exact: true }),
      ...(ok("appointments.read.any") ? [it(`${base}/appointments`, "Appointments", "CalendarCheck")] : []),
      ...(ok("staff.schedules.view") ? [it(`${base}/staff-hours`, "Staff hours", "CalendarClock")] : []),
      ...(ok("appointments.read.any") || ok("appointments.read.own") ? [it(`${base}/classes`, "Classes", "GraduationCap")] : []),
      ...(ok("waitlist.view") ? [it(`${base}/waitlist`, "Waitlist", "ListOrdered")] : []),
      it(`${base}/time`, "Time clock", "Clock"),
    ] },
    // Who: the client and team directories, and who may do what.
    { title: "People", items: [
      ...(ok("clients.read") ? [it(`${base}/clients`, "Clients", "Users")] : []),
      ...(ok("staff.directory") ? [it(`${base}/staff`, "Staff", "UserCog", { exclude: [`${base}/staff-hours`] })] : []),
      // Who may do what. A Settings page that is also a daily tool for whoever manages people, so it has its own entry (and Settings steps aside).
      ...(ok("members.manage") ? [it(`${base}/settings/roles`, "Roles", "ShieldCheck")] : []),
    ] },
    // Looking after clients day to day: their texts, what we sent them, their forms and their photos.
    { title: "Client care", items: [
      ...(ok("clients.messages") ? [it(`${base}/inbox`, "Inbox", "Inbox")] : []),
      ...(ok("settings.booking") ? [it(`${base}/messages`, "Message log", "MessageSquare")] : []),
      ...(ok("forms.manage") ? [it(`${base}/settings/forms`, "Forms", "FileText")] : []),
      ...(ok("clients.photos") || ok("clients.photos.own") ? [it(`${base}/gallery`, "Gallery", "Images")] : []),
    ] },
    { title: "Catalog", items: [
      ...(ok("catalog.view") ? [it(`${base}/services`, "Services", "Scissors"), it(`${base}/products`, "Products", "ShoppingBag")] : []),
      // Managing stock, or reading it, opens Inventory; someone who only logs supplies gets that page.
      ...(ok("inventory.manage") || ok("inventory.view") ? [it(`${base}/inventory`, "Inventory", "Boxes")] : ok("inventory.log") ? [it(`${base}/inventory/use`, "Log supplies", "Boxes")] : []),
      ...(ok("catalog.view") ? [it(`${base}/packages`, "Packages", "Package"), it(`${base}/memberships`, "Memberships", "BadgePercent")] : []),
      ...(canOpenGiftCards(permissions) ? [it(`${base}/gift-cards`, "Gift cards", "Gift")] : []),
    ] },
    { title: "Money", items: [
      ...(canOpenSales(permissions) ? [it(`${base}/sales`, "Sales & checkout", "Receipt")] : []),
      ...(ok("reports.view") ? [it(`${base}/reports`, "Reports", "BarChart3")] : []),
      ...(ok("payroll.manage") ? [it(`${base}/payroll`, "Payroll", "Wallet")] : ok("payroll.view.own") ? [it(`${base}/payroll`, "My pay", "Wallet")] : []),
    ] },
    // Bringing clients back: campaigns and promo codes, automated messages, loyalty, and what clients say.
    { title: "Grow", items: [
      ...(ok("marketing.send") ? [it(`${base}/marketing`, "Marketing", "Megaphone", { exclude: [`${base}/marketing/automations`] })] : []),
      ...(ok("settings.booking") ? [it(`${base}/marketing/automations`, "Automations", "Workflow"), it(`${base}/loyalty`, "Loyalty & referrals", "Heart", { exclude: [`${base}/settings/loyalty`] })] : []),
      ...(canSeeReviews(permissions) ? [it(`${base}/reviews`, "Reviews", "Star")] : []),
    ] },
    { title: "", items: [
      ...(ok("integrations.manage") ? [it(`${base}/settings/api`, "API", "KeyRound")] : []),
      ...(canOpenSettings(permissions) ? [it(`${base}/settings`, "Settings", "Settings", { exclude: [`${base}/settings/loyalty`, `${base}/settings/roles`, `${base}/settings/forms`, `${base}/settings/notifications`, `${base}/settings/api`] })] : []),
    ] },
  ].filter((s) => s.items.length > 0);
}

export type SettingsEntry = { href: string; title: string; blurb: string; status?: string; /** What opens the page; "settings.business" when omitted. */ action?: Action };
export type SettingsGroup = { title: string; entries: SettingsEntry[] };

export interface SettingsStatusSource {
  onlineBookingEnabled: boolean;
  loyaltyEnabled: boolean;
  storeEnabled: boolean;
  giftCardsOnline: boolean;
  customDomain: string | null;
  stripeChargesEnabled: boolean;
  locationCount: number;
}

/**
 * The Settings directory, holding only the pages this viewer may open (so nobody is shown a link that ends in a permission error).
 * Pass `status` to show each page's current state; omit it for a plain index (search).
 */
export function settingsGroups(base: string, permissions: Perms, status?: SettingsStatusSource): SettingsGroup[] {
  const s = status;
  const sb = `${base}/settings`;
  const groups: SettingsGroup[] = [
    {
      title: "Your business",
      entries: [
        { href: `${sb}/profile`, title: "Business profile", blurb: "Name, timezone, logo, colours, about text and links." },
        { href: `${sb}/locations`, title: "Locations", blurb: "Addresses, opening hours and tax rates.", status: s ? (s.locationCount === 1 ? "1 location" : `${s.locationCount} locations`) : undefined },
        { href: `${sb}/roles`, title: "Roles & permissions", blurb: "What each role can see and do.", action: "members.manage" },
      ],
    },
    {
      title: "Online booking",
      entries: [
        { href: `${sb}/booking`, title: "Booking rules", blurb: "Notice, cancellation window, reminders, deposits and no-show fee.", status: s ? (s.onlineBookingEnabled ? "on" : "off") : undefined, action: "settings.booking" },
        { href: `${sb}/forms`, title: "Forms", blurb: "Intake questionnaires and waivers.", action: "forms.manage" },
        { href: `${sb}/reviews`, title: "Reviews", blurb: "Rating requests and your Google review link.", action: "settings.booking" },
        { href: `${sb}/loyalty`, title: "Loyalty & referrals", blurb: "Points, redemption value and referral bonuses.", status: s ? (s.loyaltyEnabled ? "on" : "off") : undefined, action: "settings.booking" },
        { href: `${sb}/store`, title: "Online store", blurb: "Gift cards and products on your booking page.", status: s ? (s.storeEnabled ? "on" : s.giftCardsOnline ? "gift cards" : "off") : undefined, action: "settings.booking" },
        { href: `${sb}/embed`, title: "Embed & buttons", blurb: "Put booking on your own website." },
        { href: `${sb}/domain`, title: "Custom domain", blurb: "Serve the booking page from your hostname.", status: s?.customDomain ?? undefined },
      ],
    },
    {
      title: "Payments & billing",
      entries: [
        { href: `${sb}/payments`, title: "Card payments", blurb: "Your Stripe account for cards, deposits and saved cards.", status: s ? (s.stripeChargesEnabled ? "connected" : "not connected") : undefined, action: "billing.manage" },
        { href: `${sb}/refund-reasons`, title: "Refund reasons", blurb: "The list staff pick from when refunding; Reports group refunds by it." },
        { href: `${sb}/cancellation-reasons`, title: "Cancellation reasons", blurb: "The list staff pick from when cancelling an appointment; Reports group cancellations by it." },
        { href: `${sb}/billing`, title: "Your plan", blurb: "Subscription, card on file and this month's usage.", action: "billing.manage" },
      ],
    },
    {
      title: "Messaging",
      entries: [
        { href: `${sb}/messaging`, title: "Text number", blurb: "Your own toll-free number for confirmations and reminders." },
        { href: `${sb}/notifications`, title: "Text wording", blurb: "What confirmations and reminders say, and quick replies for the Inbox." },
      ],
    },
    {
      title: "Data",
      entries: [
        { href: `${sb}/import`, title: "Import", blurb: "Bring clients, services and appointments from Vagaro." },
        { href: `${sb}/api`, title: "API access", blurb: "Keys to read and manage your business from your own software.", action: "integrations.manage" },
        { href: `${sb}/audit`, title: "Activity log", blurb: "Who changed what, and when.", action: "audit.view" },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, entries: g.entries.filter((e) => can(permissions, e.action ?? "settings.business")) })).filter((g) => g.entries.length > 0);
}

/**
 * Every page the ⌘K palette can jump to: the sidebar, common "new …" screens and the Settings directory. The "New …" entries follow the
 * same access as the "+ New" menu (A5): booking and blocking need the calendar permissions (an own-calendar role also needs a linked staff
 * member, `staffId`), a new client needs "Add and edit clients".
 */
export function searchPages(base: string, permissions: Perms, staffId: string | null = null): { title: string; href: string; keywords?: string }[] {
  const ok = (a: Action) => can(permissions, a);
  const perms = typeof permissions === "string" || !permissions ? null : (permissions as Permissions);
  const nav = navSections(base, permissions).flatMap((s) => s.items.map((i) => ({ title: i.label, href: i.href, keywords: s.title })));
  const extras = [
    ...(perms && bookingAccess(perms, staffId) ? [{ title: "New appointment", href: `${base}/appointments/new` }] : []),
    ...(perms && blockingAccess(perms, staffId) ? [{ title: "Block time", href: `${base}/appointments/block`, keywords: "schedule time off" }] : []),
    ...(ok("clients.write") ? [{ title: "New client", href: `${base}/clients/new` }] : []),
    ...(ok("inventory.manage") ? [{ title: "Receive stock", href: `${base}/inventory/receive`, keywords: "inventory delivery" }, { title: "Count stock", href: `${base}/inventory/count`, keywords: "inventory stocktake" }, { title: "Reorder", href: `${base}/inventory/reorder`, keywords: "inventory low stock purchase order" }, { title: "Purchase orders", href: `${base}/inventory/orders`, keywords: "inventory suppliers" }, { title: "Stock history", href: `${base}/inventory/history`, keywords: "inventory movements ledger log audit" }] : []),
    ...(ok("marketing.send") ? [{ title: "Campaigns", href: `${base}/marketing`, keywords: "marketing email text" }, { title: "Promo codes", href: `${base}/marketing/promos`, keywords: "marketing discount" }] : []),
  ];
  const settings = settingsGroups(base, permissions).flatMap((g) => g.entries.map((e) => ({ title: e.title === "Forms" || e.title === "Reviews" ? `${e.title} settings` : e.title, href: e.href, keywords: `settings ${g.title} ${e.blurb}` })));
  const seen = new Set<string>();
  return [...nav, ...extras, ...settings].filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
}
