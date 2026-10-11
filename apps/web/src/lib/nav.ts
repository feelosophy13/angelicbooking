import { can, type Action } from "@angelic/core";

/**
 * The dashboard's navigation, in one place: the sidebar sections, the Settings directory and the ⌘K page
 * list are all derived from here so a page added to one is findable from the others.
 */

export type NavItem = { href: string; label: string; iconName: string; exact?: boolean; /** Paths that should not light this item up (another item owns them). */ exclude?: string[] };
export type NavSectionDef = { title: string; items: NavItem[] };

type Perms = Parameters<typeof can>[0];
const it = (href: string, label: string, iconName: string, extra?: { exact?: boolean; exclude?: string[] }): NavItem => ({ href, label, iconName, ...extra });

export function navSections(base: string, permissions: Perms): NavSectionDef[] {
  const ok = (a: Action) => can(permissions, a);
  return [
    { title: "Schedule", items: [
      it(base, "Calendar", "CalendarDays", { exact: true }),
      ...(ok("appointments.read.any") ? [it(`${base}/staff-hours`, "Staff hours", "CalendarClock")] : []),
      it(`${base}/classes`, "Classes", "GraduationCap"),
      it(`${base}/waitlist`, "Waitlist", "ListOrdered"),
      it(`${base}/time`, "Time clock", "Clock"),
    ] },
    { title: "People", items: [
      it(`${base}/clients`, "Clients", "Users"),
      it(`${base}/reviews`, "Reviews", "Star"),
      it(`${base}/staff`, "Staff", "UserCog", { exclude: [`${base}/staff-hours`] }),
      ...(ok("business.manage") ? [it(`${base}/settings/forms`, "Forms", "FileText")] : []),
    ] },
    { title: "Catalog", items: [
      it(`${base}/services`, "Services", "Scissors"),
      it(`${base}/products`, "Products", "ShoppingBag"),
      it(`${base}/packages`, "Packages", "Package"),
      it(`${base}/memberships`, "Memberships", "BadgePercent"),
      it(`${base}/gift-cards`, "Gift cards", "Gift"),
    ] },
    { title: "Money", items: [
      ...(ok("checkout.take") ? [it(`${base}/sales`, "Sales", "Receipt")] : []),
      ...(ok("reports.view") ? [it(`${base}/reports`, "Reports", "BarChart3"), it(`${base}/marketing`, "Marketing", "Megaphone", { exclude: [`${base}/marketing/automations`] })] : []),
      ...(ok("payroll.view") ? [it(`${base}/payroll`, "Payroll", "Wallet")] : []),
    ] },
    { title: "Automation", items: ok("reports.view") ? [it(`${base}/marketing/automations`, "Automations", "Workflow")] : [] },
    { title: "", items: ok("business.manage") ? [it(`${base}/settings`, "Settings", "Settings", { exclude: [`${base}/settings/forms`] })] : [] },
  ].filter((s) => s.items.length > 0);
}

export type SettingsEntry = { href: string; title: string; blurb: string; status?: string };
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

/** The Settings directory. Pass `status` to show each page's current state; omit it for a plain index (search). */
export function settingsGroups(base: string, status?: SettingsStatusSource): SettingsGroup[] {
  const s = status;
  const sb = `${base}/settings`;
  return [
    {
      title: "Your business",
      entries: [
        { href: `${sb}/profile`, title: "Business profile", blurb: "Name, timezone, logo, colours, about text and links." },
        { href: `${sb}/locations`, title: "Locations", blurb: "Addresses, opening hours and tax rates.", status: s ? (s.locationCount === 1 ? "1 location" : `${s.locationCount} locations`) : undefined },
        { href: `${sb}/roles`, title: "Roles & permissions", blurb: "What each role can see and do." },
      ],
    },
    {
      title: "Online booking",
      entries: [
        { href: `${sb}/booking`, title: "Booking rules", blurb: "Notice, cancellation window, reminders, deposits and no-show fee.", status: s ? (s.onlineBookingEnabled ? "on" : "off") : undefined },
        { href: `${sb}/forms`, title: "Forms", blurb: "Intake questionnaires and waivers." },
        { href: `${sb}/reviews`, title: "Reviews", blurb: "Rating requests and your Google review link." },
        { href: `${sb}/loyalty`, title: "Loyalty & referrals", blurb: "Points, redemption value and referral bonuses.", status: s ? (s.loyaltyEnabled ? "on" : "off") : undefined },
        { href: `${sb}/store`, title: "Online store", blurb: "Gift cards and products on your booking page.", status: s ? (s.storeEnabled ? "on" : s.giftCardsOnline ? "gift cards" : "off") : undefined },
        { href: `${sb}/embed`, title: "Embed & buttons", blurb: "Put booking on your own website." },
        { href: `${sb}/domain`, title: "Custom domain", blurb: "Serve the booking page from your hostname.", status: s?.customDomain ?? undefined },
      ],
    },
    {
      title: "Payments & billing",
      entries: [
        { href: `${sb}/payments`, title: "Card payments", blurb: "Your Stripe account for cards, deposits and saved cards.", status: s ? (s.stripeChargesEnabled ? "connected" : "not connected") : undefined },
        { href: `${sb}/billing`, title: "Your plan", blurb: "Subscription, card on file and this month's usage." },
      ],
    },
    {
      title: "Messaging",
      entries: [
        { href: `${sb}/messaging`, title: "Text number", blurb: "Your own toll-free number for confirmations and reminders." },
        { href: `${sb}/notifications`, title: "Messages", blurb: "Text wording, replies from clients and the delivery log." },
      ],
    },
    {
      title: "Data",
      entries: [
        { href: `${sb}/import`, title: "Import", blurb: "Bring clients, services and appointments from Vagaro." },
        { href: `${sb}/audit`, title: "Activity log", blurb: "Who changed what, and when." },
      ],
    },
  ];
}

/** Every page the ⌘K palette can jump to: the sidebar, common "new …" screens and the Settings directory. */
export function searchPages(base: string, permissions: Perms): { title: string; href: string; keywords?: string }[] {
  const ok = (a: Action) => can(permissions, a);
  const nav = navSections(base, permissions).flatMap((s) => s.items.map((i) => ({ title: i.label, href: i.href, keywords: s.title })));
  const extras = [
    { title: "New appointment", href: `${base}/appointments/new` },
    { title: "Block time", href: `${base}/appointments/block`, keywords: "schedule time off" },
    { title: "New client", href: `${base}/clients/new` },
    ...(ok("reports.view") ? [{ title: "Campaigns", href: `${base}/marketing`, keywords: "marketing email text" }, { title: "Promo codes", href: `${base}/marketing/promos`, keywords: "marketing discount" }] : []),
  ];
  const settings = ok("business.manage") ? settingsGroups(base).flatMap((g) => g.entries.map((e) => ({ title: e.title === "Forms" || e.title === "Reviews" ? `${e.title} settings` : e.title, href: e.href, keywords: `settings ${g.title} ${e.blurb}` }))) : [];
  const seen = new Set<string>();
  return [...nav, ...extras, ...settings].filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));
}
