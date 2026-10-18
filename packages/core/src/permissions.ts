export const ROLES = ["owner", "manager", "provider", "front_desk"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "business.manage", // everyday settings: profile, booking rules, locations, wording, store, loyalty, reviews, reasons, forms, imports, embed, domain
  // Split out of "business.manage" 2026-10-18 (migration 0115 back-fills stored roles) so the owner can hand the settings to a manager
  // without handing over the money and the keys.
  "billing.manage", // Settings → Payments (the Stripe connection and payouts) and Settings → Billing (the platform subscription and card)
  "integrations.manage", // Settings → API keys, and buying and verifying the text number
  "audit.view", // Settings → Activity log
  "members.manage",
  "staff.manage",
  "services.manage",
  "clients.read", // the client list, a client's contact details and visit history
  "clients.write",
  // Client data that "View clients" used to imply. Split out 2026-10-18 (migration 0114 back-fills stored roles) so a role can open a
  // client without also getting the whole list as a file, every text conversation, every photo, or balances.
  "clients.export", // download the client list as a CSV
  "clients.notes", // private notes, lash maps and signed forms
  "clients.messages", // the SMS inbox and a client's text thread
  "clients.photos", // the gallery and visit photos
  "clients.balances", // store credit and loyalty balances
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
  "checkout.take",
  "checkout.discount", // discounts, price changes and voids on a ticket (Manager and Front desk by default)
  "giftcards.issue", // create a gift card nobody paid for (a comp or a correction); selling one at checkout is checkout.take
  "reports.view",
  "checkout.refund", // send money back: refunds, store credit, deposit refunds
  "payroll.view",
  "inventory.log", // record the supplies used on a visit (Provider and Front desk by default)
  "inventory.manage", // receive, count, adjust and order stock; suppliers (the catalog itself is services.manage)
] as const;
export type Action = (typeof ACTIONS)[number];

/** Human-readable grouping used by the role editor. */
export const PERMISSION_GROUPS: { title: string; items: { action: Action; label: string; description: string }[] }[] = [
  {
    title: "Calendar & appointments",
    items: [
      { action: "appointments.read.own", label: "See their own calendar", description: "View appointments booked with them." },
      { action: "appointments.write.own", label: "Update their own appointments", description: "Check in, complete, mark no-show, add notes and photos, and check out their own clients." },
      { action: "appointments.book.own", label: "Book appointments for themselves", description: "Create new appointments on their own calendar." },
      { action: "appointments.change.own", label: "Change their own bookings", description: "Add, remove or move the services on their own appointments, and drag them to new times." },
      { action: "appointments.cancel.own", label: "Cancel their own appointments", description: "Cancel their own appointments, charge no-show or late fees, and end standing appointments." },
      { action: "appointments.block.own", label: "Block time on their own calendar", description: "Take time off the books (lunch, training, a late start) and move or remove their own blocks." },
      { action: "appointments.read.any", label: "See every calendar", description: "View all staff members' appointments." },
      { action: "appointments.write.any", label: "Manage any appointment", description: "Book, move, cancel and change status for anyone." },
    ],
  },
  {
    title: "Clients",
    items: [
      { action: "clients.read", label: "View clients", description: "See the client list, and a client's contact details and visit history." },
      { action: "clients.write", label: "Add and edit clients", description: "Create clients and change their details." },
      { action: "clients.notes", label: "Read notes and forms", description: "Private notes (formulas, allergies), lash maps and the forms a client signed." },
      { action: "clients.photos", label: "See visit photos", description: "The Gallery and the before-and-after photos on a client's profile." },
      { action: "clients.messages", label: "Read client texts", description: "The Inbox and a client's text thread. Replying also needs \"Add and edit clients\"." },
      { action: "clients.balances", label: "See store credit and points", description: "A client's store credit and loyalty balances, and their history." },
      { action: "clients.export", label: "Download the client list", description: "Export every client (contact details, spend, notes) as a CSV file. Each download is in the activity log." },
    ],
  },
  {
    title: "Checkout & money",
    items: [
      { action: "checkout.take", label: "Take payments", description: "Open checkout, record payments, sell packages and gift cards. A role that sees only its own calendar sees only its own tickets." },
      { action: "checkout.discount", label: "Discounts and price changes", description: "Discount a ticket, change a price, and void an unpaid ticket." },
      { action: "giftcards.issue", label: "Issue free gift cards", description: "Create a gift card with no payment (a comp or a correction)." },
      { action: "reports.view", label: "View sales reports", description: "Sales, tips and refunds across the business." },
      { action: "checkout.refund", label: "Refund payments", description: "Refund a sale, give store credit, or refund a deposit." },
      { action: "payroll.view", label: "Run payroll", description: "See pay rules and generate pay sheets for everyone." },
    ],
  },
  {
    title: "Inventory",
    items: [
      { action: "inventory.log", label: "Log supplies used", description: "Record the products used up on a visit (color, adhesive, masks) from the appointment or the Log usage page." },
      { action: "inventory.manage", label: "Manage inventory", description: "Receive and count stock, write off or transfer it, and handle suppliers, purchase orders and reorders." },
    ],
  },
  {
    title: "Setup",
    items: [
      { action: "services.manage", label: "Manage the catalog", description: "Services, products, categories, packages and plans." },
      { action: "staff.manage", label: "Manage staff", description: "Add staff, set hours and time off, assign services." },
      { action: "members.manage", label: "Manage logins and roles", description: "Invite people, assign roles, revoke access." },
      { action: "business.manage", label: "Business settings", description: "Profile, booking rules, locations, text wording, forms, store, loyalty, reviews, refund and cancellation reasons, imports, embed and domain. Not payments, billing or API keys." },
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

/** Default permissions for the built-in roles. Businesses can edit copies of these. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  owner: ALL,
  manager: new Set<Action>(ACTIONS.filter((a) => a !== "billing.manage" && a !== "integrations.manage")),
  front_desk: new Set<Action>(["clients.read", "clients.write", "clients.notes", "clients.messages", "clients.balances", "appointments.read.any", "appointments.read.own", "appointments.write.any", "appointments.write.own", "checkout.take", "checkout.discount", "inventory.log"]),
  provider: new Set<Action>(["clients.read", "clients.notes", "clients.photos", "appointments.read.own", "appointments.write.own", "checkout.take", "inventory.log"]),
};

export const DEFAULT_ROLE_META: Record<Role, { name: string; description: string }> = {
  owner: { name: "Owner", description: "Full access, including billing and payments. Cannot be edited." },
  manager: { name: "Manager", description: "Everything except Stripe, billing and API keys." },
  front_desk: { name: "Front desk", description: "All calendars, clients and checkout. No reports or setup." },
  provider: { name: "Provider", description: "Their own calendar and checkout." },
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
