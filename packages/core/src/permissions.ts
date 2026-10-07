export const ROLES = ["owner", "manager", "provider", "front_desk"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "business.manage", // settings, billing, Stripe connection
  "members.manage",
  "staff.manage",
  "services.manage",
  "clients.read",
  "clients.write",
  "appointments.read.any",
  "appointments.read.own",
  "appointments.write.any",
  "appointments.write.own",
  "checkout.take",
  "reports.view",
  "payroll.view",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Human-readable grouping used by the role editor. */
export const PERMISSION_GROUPS: { title: string; items: { action: Action; label: string; description: string }[] }[] = [
  {
    title: "Calendar & appointments",
    items: [
      { action: "appointments.read.own", label: "See their own calendar", description: "View appointments booked with them." },
      { action: "appointments.write.own", label: "Manage their own appointments", description: "Book, move and change status on their own calendar." },
      { action: "appointments.read.any", label: "See every calendar", description: "View all staff members' appointments." },
      { action: "appointments.write.any", label: "Manage any appointment", description: "Book, move, cancel and change status for anyone." },
    ],
  },
  {
    title: "Clients",
    items: [
      { action: "clients.read", label: "View clients", description: "Open client profiles, history and notes." },
      { action: "clients.write", label: "Add and edit clients", description: "Create clients and change their details." },
    ],
  },
  {
    title: "Checkout & money",
    items: [
      { action: "checkout.take", label: "Take payments", description: "Open checkout, record payments, sell packages and gift cards." },
      { action: "reports.view", label: "View sales reports", description: "Sales, tips and refunds across the business. Also allows refunds." },
      { action: "payroll.view", label: "Run payroll", description: "See pay rules and generate pay sheets for everyone." },
    ],
  },
  {
    title: "Setup",
    items: [
      { action: "services.manage", label: "Manage the catalog", description: "Services, products, categories, packages and plans." },
      { action: "staff.manage", label: "Manage staff", description: "Add staff, set hours and time off, assign services." },
      { action: "members.manage", label: "Manage logins and roles", description: "Invite people, assign roles, revoke access." },
      { action: "business.manage", label: "Business settings", description: "Profile, online booking, payments (Stripe), locations, imports." },
    ],
  },
];

const ALL = new Set<Action>(ACTIONS);

/** Default permissions for the built-in roles. Businesses can edit copies of these. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  owner: ALL,
  manager: new Set<Action>(ACTIONS.filter((a) => a !== "business.manage")),
  front_desk: new Set<Action>(["clients.read", "clients.write", "appointments.read.any", "appointments.read.own", "appointments.write.any", "appointments.write.own", "checkout.take"]),
  provider: new Set<Action>(["clients.read", "appointments.read.own", "appointments.write.own", "checkout.take"]),
};

export const DEFAULT_ROLE_META: Record<Role, { name: string; description: string }> = {
  owner: { name: "Owner", description: "Full access, including billing and payments. Cannot be edited." },
  manager: { name: "Manager", description: "Everything except business settings and Stripe." },
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
