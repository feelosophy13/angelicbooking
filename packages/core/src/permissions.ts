export const ROLES = ["owner", "manager", "provider", "front_desk"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every permission in the app. Behaviour is decided by these keys, never by a role's name: a business makes up its own roles and the
 * four built-in ones are only defaults. A new permission is one line here, one in PERMISSION_GROUPS (the Roles page renders from it),
 * a default per built-in role below, and a migration that back-fills stored roles so nobody loses what they use today.
 */
export const ACTIONS = [
  // Calendar
  "appointments.read.any",
  "appointments.read.own",
  "appointments.write.any",
  "appointments.write.own",
  // Beyond updating their own appointments, what a Provider (or any custom role) may also do on their own calendar. Off for Provider by default;
  // the owner switches them on under Roles & permissions. ("appointments.write.any" already covers all of it, for everyone.)
  "appointments.book.own",
  "appointments.change.own",
  "appointments.cancel.own",
  "appointments.block.own",
  // Between "own" and "any": colleagues' columns as busy and free time only, with no client, service or price (migration 0120).
  "appointments.read.availability",
  // Split out of the calendar permissions 2026-10-18 (migration 0119): the waitlist page and working it.
  "waitlist.view",
  "waitlist.manage",
  // Classes: run their own (instructor = self) or every class (migration 0120; "any" was appointments.write.any).
  "classes.manage.own",
  "classes.manage.any",
  // Clients
  "clients.read", // the client list and a client's profile: name, visits; contact details and spend are their own permissions
  "clients.contact", // phone, email, address, birthday, wherever a client is shown (list, profile, appointment, hover card, roster, search, mobile)
  "clients.spend", // lifetime spend, spend per visit and tips on the list and profile
  "clients.write",
  // Client data that "View clients" used to imply. Split out 2026-10-18 (migration 0114 back-fills stored roles) so a role can open a
  // client without also getting the whole list as a file, every text conversation, every photo, or balances.
  "clients.export", // download the client list as a CSV
  "clients.notes", // private notes, lash maps and signed forms
  "clients.messages", // the SMS inbox and a client's text thread
  "clients.photos", // the gallery and visit photos, everyone's
  "clients.photos.own", // the gallery and a profile's photos filtered to the lines they performed (migration 0120)
  "clients.balances", // store credit and loyalty balances
  // Reviews (split out of clients.read 2026-10-18, migration 0119)
  "reviews.view", // every review, per-provider averages, ratings on client profiles, API reviews:read
  "reviews.view.own", // the reviews of visits they performed
  // Checkout and money
  "checkout.take",
  "sales.view.own", // the tickets they are credited on, whatever their calendar permissions
  "sales.view.all", // every ticket; refunding someone else's ticket needs this
  "checkout.discount", // discounts, price changes, voids and the tax-exempt switch on a ticket (Manager and Front desk by default)
  "checkout.tips.adjust", // add a tip after payment, or move a tip to another person (migration 0120)
  "checkout.refund", // send money back: refunds, store credit, deposit refunds (on a ticket they may see)
  "giftcards.view", // the Gift cards page: masked codes and balances
  "giftcards.issue", // create a gift card nobody paid for (a comp or a correction); selling one at checkout is checkout.take
  "reports.view",
  "reports.staff", // the per-person table in Reports: services, products and tips by staff member (migration 0120)
  "payroll.manage", // run payroll for everyone (was payroll.view until migration 0120)
  "payroll.view.own", // their own pay sheet: the Payroll page and export filtered to themselves
  // Staff
  "staff.directory", // the staff list: names, photos, positions
  "staff.schedules.view", // colleagues' hours, days worked and time off: Staff hours, the staff list's days, API staff:read
  "staff.manage",
  "staff.self.hours", // edit their own weekly hours and time off without managing staff (migration 0120)
  "staff.self.services", // edit the services they perform and their own prices
  "time.view.all", // everyone's time clock entries and totals (own entries need no permission)
  "time.edit", // add, correct or remove time clock entries
  "members.manage",
  // Catalog and inventory
  "catalog.view", // the service and product menu: names, durations, options
  "catalog.prices", // prices on the menu, the hover card, class seats
  "catalog.costs", // product cost and margins, the product export
  "services.manage",
  "inventory.view", // stock levels, read-only inventory pages, the stock export
  "inventory.log", // record the supplies used on a visit (Provider and Front desk by default)
  "inventory.manage", // receive, count, adjust and order stock; suppliers (the catalog itself is services.manage)
  // Marketing and forms
  // Split out of "reports.view" 2026-10-18 (migration 0116 back-fills stored roles): reading the money reports no longer lets someone text or
  // email every client. Campaigns, promo codes and the Marketing pages; automations themselves are settings.booking.
  "marketing.send",
  "forms.manage", // design forms, and void, reassign or email a signed copy
  // Settings. "business.manage" was split 2026-10-18 (migration 0115: billing, integrations, audit) and retired 2026-10-19 (migration 0120:
  // settings.business + settings.booking + forms.manage), so the owner can hand over setup without the money and the keys.
  "settings.business", // business profile and setup: profile, locations, text wording and number, reasons, embed, domain, import
  "settings.booking", // booking, store and client-care rules: booking rules, deposits, fees, store, loyalty, review requests, automations, message log
  "billing.manage", // Settings → Payments (the Stripe connection and payouts) and Settings → Billing (the platform subscription and card)
  "integrations.manage", // Settings → API keys, and buying and verifying the text number
  "audit.view", // Settings → Activity log
] as const;
export type Action = (typeof ACTIONS)[number];

/** How the Roles page lists permissions: a group per area of the app, each permission with a one-line label and what it opens. */
export const PERMISSION_GROUPS: { title: string; description: string; items: { action: Action; label: string; description: string }[] }[] = [
  {
    title: "Calendar",
    description: "Whose appointments they see and what they may do to them.",
    items: [
      { action: "appointments.read.own", label: "See their own calendar", description: "View appointments booked with them." },
      { action: "appointments.write.own", label: "Update their own appointments", description: "Check in, complete, mark no-show, add notes and photos, and check out their own clients." },
      { action: "appointments.book.own", label: "Book appointments for themselves", description: "Create new appointments on their own calendar." },
      { action: "appointments.change.own", label: "Change their own bookings", description: "Add, remove or move the services on their own appointments, and drag them to new times." },
      { action: "appointments.cancel.own", label: "Cancel their own appointments", description: "Cancel their own appointments, charge no-show or late fees, and end standing appointments." },
      { action: "appointments.block.own", label: "Block time on their own calendar", description: "Take time off the books (lunch, training, a late start) and move or remove their own blocks." },
      { action: "appointments.read.availability", label: "See when colleagues are busy", description: "Other providers' columns show only busy and free time: no client, service or price. A step between their own calendar and every calendar." },
      { action: "appointments.read.any", label: "See every calendar", description: "View all staff members' appointments." },
      { action: "appointments.write.any", label: "Manage any appointment", description: "Book, move, cancel and change status for anyone." },
      { action: "waitlist.view", label: "See the waitlist", description: "Who is waiting for a spot, and for what." },
      { action: "waitlist.manage", label: "Work the waitlist", description: "Book clients from the waitlist and close entries." },
      { action: "classes.manage.own", label: "Run their own classes", description: "Schedule classes they teach, add clients to them and cancel them." },
      { action: "classes.manage.any", label: "Run every class", description: "Schedule, fill and cancel any class, whoever teaches it." },
    ],
  },
  {
    title: "Clients",
    description: "The client list and what of each client's record they can see.",
    items: [
      { action: "clients.read", label: "View clients", description: "The client list and a client's profile: name, visits and history. Contact details and spend are separate." },
      { action: "clients.contact", label: "See phone, email, address and birthday", description: "Contact details wherever a client is shown: the list, profile, appointment, hover card, class roster and search." },
      { action: "clients.spend", label: "See what clients spend", description: "Lifetime spend, spend per visit and tips on the client list and profile." },
      { action: "clients.write", label: "Add and edit clients", description: "Create clients and change their details." },
      { action: "clients.notes", label: "Read notes and forms", description: "Private notes (formulas, allergies), lash maps and the forms a client signed." },
      { action: "clients.photos", label: "See every visit photo", description: "The Gallery and the before-and-after photos on a client's profile, for every stylist." },
      { action: "clients.photos.own", label: "See their own visit photos", description: "The Gallery and a profile's photos, only from the services they performed." },
      { action: "clients.messages", label: "Read client texts", description: "The Inbox and a client's text thread. Replying also needs \"Add and edit clients\"." },
      { action: "clients.balances", label: "See store credit and points", description: "A client's store credit and loyalty balances, and their history." },
      { action: "clients.export", label: "Download the client list", description: "Export every client (contact details, spend, notes) as a CSV file. Each download is in the activity log." },
    ],
  },
  {
    title: "Reviews",
    description: "What clients said after their visits.",
    items: [
      { action: "reviews.view", label: "See all reviews", description: "Every rating and comment, averages per provider, and ratings on client profiles." },
      { action: "reviews.view.own", label: "See their own reviews", description: "Ratings and comments on the visits they performed. The client's name shows only with \"See phone, email, address and birthday\"." },
    ],
  },
  {
    title: "Checkout and money",
    description: "Taking payments, seeing tickets, and the business's numbers.",
    items: [
      { action: "checkout.take", label: "Take payments", description: "Open checkout, record payments, sell packages and gift cards." },
      { action: "sales.view.own", label: "See their own tickets", description: "The sales they are credited on, in the Sales list and on each ticket." },
      { action: "sales.view.all", label: "See every ticket", description: "Every sale, with tips per stylist and how it was paid." },
      { action: "checkout.discount", label: "Discounts, price changes and tax", description: "Discount a ticket, change a price, void an unpaid ticket, and mark a ticket tax-exempt." },
      { action: "checkout.tips.adjust", label: "Add or move tips after payment", description: "Add a tip to a paid ticket, or move a tip to the right person." },
      { action: "checkout.refund", label: "Refund payments", description: "Refund a sale, give store credit, or refund a deposit, on a ticket they can see." },
      { action: "giftcards.view", label: "Look up gift cards", description: "The Gift cards page: balances and masked codes." },
      { action: "giftcards.issue", label: "Issue free gift cards", description: "Create a gift card with no payment (a comp or a correction), and see full codes." },
      { action: "reports.view", label: "View business reports", description: "Sales, tips, refunds and cancellations across the business." },
      { action: "reports.staff", label: "See sales by staff member", description: "The per-person table in Reports: who sold what, and their tips." },
      { action: "payroll.manage", label: "Run payroll for everyone", description: "Pay rules, pay sheets, adjustments and finalizing periods, for the whole team." },
      { action: "payroll.view.own", label: "See their own pay sheet", description: "The Payroll page and export filtered to themselves: their own pay, tips and hours." },
    ],
  },
  {
    title: "Staff",
    description: "The team: who they can see, whose hours, and who may change them.",
    items: [
      { action: "staff.directory", label: "See the staff list", description: "Names, photos and positions of the team." },
      { action: "staff.schedules.view", label: "See colleagues' hours and time off", description: "Days worked on the staff list, the Staff hours page and the time-off list." },
      { action: "staff.manage", label: "Manage staff", description: "Add staff, set hours and time off, assign services, for everyone." },
      { action: "staff.self.hours", label: "Edit their own hours and time off", description: "Their own Weekly hours and Time off tabs, without managing anyone else." },
      { action: "staff.self.services", label: "Edit their own services and prices", description: "Their own Services tab: what they perform and their own price or time for it." },
      { action: "time.view.all", label: "See everyone's time clock", description: "Every person's clock-ins and hours. Everyone sees their own." },
      { action: "time.edit", label: "Add, edit and delete hours", description: "Add hours by hand and correct or remove clock entries. These feed payroll." },
      { action: "members.manage", label: "Manage logins and roles", description: "Invite people, assign roles, revoke access." },
    ],
  },
  {
    title: "Catalog and inventory",
    description: "The menu, prices, costs and stock.",
    items: [
      { action: "catalog.view", label: "See the service and product menu", description: "Services, products, packages and plans: names, durations and options." },
      { action: "catalog.prices", label: "See prices", description: "Prices on the menu, on the calendar hover card, and the price of a class seat." },
      { action: "catalog.costs", label: "See product cost and margins", description: "What each product costs you, on its page and in the product export." },
      { action: "services.manage", label: "Manage the catalog", description: "Add and change services, products, categories, packages and plans." },
      { action: "inventory.view", label: "See stock levels", description: "How many are in stock, and what the team has logged as used." },
      { action: "inventory.log", label: "Log supplies used", description: "Record the products used up on a visit (color, adhesive, masks) from the appointment or the Log usage page." },
      { action: "inventory.manage", label: "Manage inventory", description: "Receive and count stock, write off or transfer it, and handle suppliers, purchase orders and reorders." },
    ],
  },
  {
    title: "Marketing and forms",
    description: "Reaching clients, and the forms they sign.",
    items: [
      { action: "marketing.send", label: "Send marketing", description: "Campaigns by text or email to groups of clients, and promo codes. Automations are under \"Booking, store and client-care rules\"." },
      { action: "forms.manage", label: "Design forms and manage signed copies", description: "Create and edit intake forms and waivers; void, reassign or email a signed form." },
    ],
  },
  {
    title: "Settings",
    description: "How the business is set up, and the money and keys behind it.",
    items: [
      { action: "settings.business", label: "Business profile and setup", description: "Profile, locations, text wording and text number, refund and cancellation reasons, embed, domain and imports." },
      { action: "settings.booking", label: "Booking, store and client-care rules", description: "Booking rules, deposits and fees, the online store, loyalty, review requests, automations and the message log." },
      { action: "billing.manage", label: "Payments and billing", description: "Connect or disconnect the Stripe account that receives card payments, and manage the subscription and the card on file." },
      { action: "integrations.manage", label: "API keys and text number", description: "Create and revoke API keys, and buy, verify or release the business's text number." },
      { action: "audit.view", label: "See the activity log", description: "Who changed what, and when, across the whole business." },
    ],
  },
];

/**
 * Everything a person can do to an appointment, each with the permission for doing it to anyone's ("any") and to their own ("own").
 * One table drives the access checks on the web and in the app, so a new capability is one line here, one in PERMISSION_GROUPS, and a
 * default for the built-in roles (usually off). "Any" for the changing kinds is the broad `appointments.write.any`.
 *   read    see it                              write   update it: status, notes, photos, checkout
 *   change  add, remove or move its services    cancel  cancel it, charge fees, end a series
 *   block   blocked time (create, move, remove) book    create a new appointment
 */
export const APPOINTMENT_CAPABILITIES = {
  read: { any: "appointments.read.any", own: "appointments.read.own" },
  write: { any: "appointments.write.any", own: "appointments.write.own" },
  change: { any: "appointments.write.any", own: "appointments.change.own" },
  cancel: { any: "appointments.write.any", own: "appointments.cancel.own" },
  block: { any: "appointments.write.any", own: "appointments.block.own" },
  book: { any: "appointments.write.any", own: "appointments.book.own" },
} as const satisfies Record<string, { any: Action; own: Action }>;
export type AppointmentCapability = keyof typeof APPOINTMENT_CAPABILITIES;

const ALL = new Set<Action>(ACTIONS);
/**
 * What the Manager default leaves out: the money and the keys, and the self-service and availability permissions that are off for every
 * default. It keeps the "own" variants the Provider default has (reviews, sales, photos) even though "all" covers them, because a manager
 * may only change a role whose permissions they hold.
 */
const NOT_MANAGER = new Set<Action>(["billing.manage", "integrations.manage", "payroll.view.own", "staff.self.hours", "staff.self.services", "appointments.read.availability"]);

/** Default permissions for the built-in roles. Businesses can edit copies of these. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  owner: ALL,
  manager: new Set<Action>(ACTIONS.filter((a) => !NOT_MANAGER.has(a))),
  front_desk: new Set<Action>([
    "appointments.read.any", "appointments.read.own", "appointments.write.any", "appointments.write.own", "waitlist.view", "waitlist.manage", "classes.manage.any",
    "clients.read", "clients.contact", "clients.spend", "clients.write", "clients.notes", "clients.messages", "clients.photos", "clients.balances",
    "reviews.view",
    "checkout.take", "sales.view.all", "checkout.discount", "checkout.tips.adjust", "giftcards.view",
    "staff.directory", "staff.schedules.view", "time.view.all",
    "catalog.view", "catalog.prices", "inventory.view", "inventory.log",
  ]),
  provider: new Set<Action>([
    "appointments.read.own", "appointments.write.own",
    "clients.read", "clients.notes", "clients.photos.own",
    "reviews.view.own",
    "checkout.take", "sales.view.own",
    "staff.directory",
    "catalog.view", "catalog.prices", "inventory.log",
  ]),
};

export const DEFAULT_ROLE_META: Record<Role, { name: string; description: string }> = {
  owner: { name: "Owner", description: "Everything, including payments, billing and API keys. Can't be edited." },
  manager: { name: "Manager", description: "Runs the salon day to day: every calendar, client, ticket, report, payroll and setting. No Stripe, billing or API keys." },
  front_desk: { name: "Front desk", description: "Books and checks out for everyone: every calendar, client and ticket, the waitlist and gift cards. No reports, pay or settings." },
  provider: { name: "Provider", description: "Their own calendar, the clients they see (no contact details or spend), their own tickets, reviews and photos." },
};

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as readonly string[]).includes(x);
}

export function isAction(x: unknown): x is Action {
  return typeof x === "string" && (ACTIONS as readonly string[]).includes(x);
}

export type Permissions = ReadonlySet<Action>;

/**
 * Permission check. Accepts a resolved permission set (preferred: comes from the
 * business's roles table) or a built-in role key as a fallback.
 */
export function can(subject: Permissions | Role | string | null | undefined, action: Action): boolean {
  if (!subject) return false;
  if (typeof subject === "string") return isRole(subject) ? DEFAULT_ROLE_PERMISSIONS[subject].has(action) : false;
  return subject.has(action);
}

/** Whether `subject` may act on an appointment item belonging to `itemStaffUserId`. */
export function canActOnAppointment(subject: Permissions | Role | string | null | undefined, mode: "read" | "write", actorUserId: string, itemStaffUserId: string | null | undefined): boolean {
  if (can(subject, mode === "read" ? "appointments.read.any" : "appointments.write.any")) return true;
  if (can(subject, mode === "read" ? "appointments.read.own" : "appointments.write.own")) {
    return !!itemStaffUserId && itemStaffUserId === actorUserId;
  }
  return false;
}

/**
 * Whether a person with this role works their own calendar (they take appointments and show up as bookable) rather than running the
 * business: they see their own appointments but not everyone's. Decided by the role's permissions, never by its name, so it holds for
 * roles a business makes up ("Stylist", "Assistant") as well as the built-in Provider.
 */
export function worksOwnCalendar(subject: Permissions | Role | string | null | undefined): boolean {
  return can(subject, "appointments.read.own") && !can(subject, "appointments.read.any");
}
