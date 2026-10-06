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

const ALL = new Set<Action>(ACTIONS);

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: ALL,
  manager: new Set<Action>(ACTIONS.filter((a) => a !== "business.manage")),
  front_desk: new Set<Action>([
    "clients.read",
    "clients.write",
    "appointments.read.any",
    "appointments.read.own",
    "appointments.write.any",
    "appointments.write.own",
    "checkout.take",
  ]),
  provider: new Set<Action>(["clients.read", "appointments.read.own", "appointments.write.own", "checkout.take"]),
};

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as readonly string[]).includes(x);
}

export function can(role: Role | string | null | undefined, action: Action): boolean {
  if (!isRole(role)) return false;
  return MATRIX[role].has(action);
}

/** Whether `role` may act on an appointment item belonging to `itemStaffUserId`. */
export function canActOnAppointment(
  role: Role | string | null | undefined,
  mode: "read" | "write",
  actorUserId: string,
  itemStaffUserId: string | null | undefined,
): boolean {
  if (can(role, mode === "read" ? "appointments.read.any" : "appointments.write.any")) return true;
  if (can(role, mode === "read" ? "appointments.read.own" : "appointments.write.own")) {
    return !!itemStaffUserId && itemStaffUserId === actorUserId;
  }
  return false;
}
