import { and, asc, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema, withTenant } from "@angelic/db";
import { ACTIONS, DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, ROLES, isAction, type Action, type Permissions } from "@angelic/core";
import { auth } from "@/lib/auth";
import { roleChangeBlocker } from "@/lib/role-rules";

export type RoleRow = typeof schema.roles.$inferSelect;

/** Make sure a business has the four built-in roles (idempotent). */
export async function ensureDefaultRoles(businessId: string) {
  await withTenant(businessId, async (tx) => {
    const existing = await tx.select({ key: schema.roles.key }).from(schema.roles);
    const have = new Set(existing.map((r) => r.key));
    const missing = ROLES.filter((k) => !have.has(k));
    if (!missing.length) return;
    await tx.insert(schema.roles).values(
      missing.map((key, i) => ({
        businessId,
        key,
        name: DEFAULT_ROLE_META[key].name,
        description: DEFAULT_ROLE_META[key].description,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[key]],
        isSystem: true,
        sortOrder: ROLES.indexOf(key) + i * 0,
      })),
    );
  });
}

export async function listRoles(businessId: string) {
  await ensureDefaultRoles(businessId);
  const [roles, counts] = await Promise.all([
    withTenant(businessId, (tx) => tx.select().from(schema.roles).orderBy(asc(schema.roles.sortOrder), asc(schema.roles.name))),
    db.select({ role: schema.member.role, n: sql<number>`count(*)` }).from(schema.member).where(eq(schema.member.organizationId, businessId)).groupBy(schema.member.role),
  ]);
  const countByKey = Object.fromEntries(counts.map((c) => [c.role, Number(c.n)]));
  return roles.map((r) => ({ ...r, members: countByKey[r.key] ?? 0 }));
}

export async function getRole(businessId: string, id: string) {
  return withTenant(businessId, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, id) }));
}

/** Resolve a member's role key to a permission set. Unknown keys get nothing. */
export async function permissionsForRole(businessId: string, roleKey: string): Promise<Permissions> {
  if (roleKey === "owner") return DEFAULT_ROLE_PERMISSIONS.owner;
  const row = await withTenant(businessId, (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.key, roleKey) }));
  if (row) return new Set(row.permissions.filter(isAction) as Action[]);
  // Legacy fallback for businesses created before the roles table existed.
  if ((ROLES as readonly string[]).includes(roleKey)) {
    await ensureDefaultRoles(businessId);
    return DEFAULT_ROLE_PERMISSIONS[roleKey as keyof typeof DEFAULT_ROLE_PERMISSIONS];
  }
  return new Set();
}

/** Better Auth's own (organization-management) permissions implied by our actions. */
function orgPermissionFor(perms: Iterable<string>): Record<string, string[]> {
  const set = new Set(perms);
  const out: Record<string, string[]> = {};
  if (set.has("members.manage")) {
    out.member = ["create", "update", "delete"];
    out.invitation = ["create", "cancel"];
  }
  if (set.has("business.manage")) out.organization = ["update"];
  return out;
}

export function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** A refused role or access change. `kind` is for callers that answer over HTTP: a rule the actor may not cross is "forbidden"; the rest is a "conflict" with the business's state. */
export class RoleError extends Error {
  constructor(message: string, public kind: "forbidden" | "conflict" | "not_found" = "conflict") {
    super(message);
  }
}

/** Who is changing roles or access: their real role and what it allows. */
export type RoleActor = { userId: string; role: string; permissions: Permissions };

/**
 * How a role write is carried out. `syncAuth: false` skips the login system's copy of the role: the public API acts for a key, with no
 * signed-in person to make that call as, so the role lives in the roles table until someone saves it in the app. `viaKeyId` is
 * recorded in the audit row when a key, not a person at the keyboard, made the change (the actor is still the key's creator).
 */
export type RoleWriteOptions = { syncAuth?: boolean; viaKeyId?: string };

/**
 * Nobody hands out more than they hold. An owner may do anything; anyone else may only grant, remove or assign permissions their
 * own role has, so a manager can't give themselves (or a friend) Stripe, billing or payroll.
 */
function assertWithinActor(actor: RoleActor, perms: Iterable<string>, message: string) {
  if (actor.role === "owner") return;
  for (const p of perms) if (!actor.permissions.has(p as Action)) throw new RoleError(message, "forbidden");
}

async function permissionsOfRoleKey(businessId: string, roleKey: string): Promise<Set<string>> {
  return new Set(await permissionsForRole(businessId, roleKey));
}

/** For invitations: the role must be one of ours, not the owner role, and within what the inviter holds. */
export async function assertMayAssignRole(businessId: string, roleKey: string, actor: RoleActor) {
  if (roleKey === "owner") throw new RoleError("Only an owner can make someone an owner.");
  const roles = await listRoles(businessId);
  const role = roles.find((r) => r.key === roleKey);
  if (!role) throw new RoleError("Unknown role.");
  assertWithinActor(actor, role.permissions, "You can't give someone a role with permissions your own role doesn't have.");
}

async function audit(businessId: string, actorUserId: string, action: string, entity: string, entityId: string | null, diff: unknown, opts: RoleWriteOptions = {}) {
  const prefixed = opts.viaKeyId ? `api.${action}` : action;
  const body = opts.viaKeyId ? { ...(diff as Record<string, unknown>), viaKeyId: opts.viaKeyId } : diff;
  await withTenant(businessId, (tx) => tx.insert(schema.auditLog).values({ businessId, actorUserId, action: prefixed, entity, entityId, diff: JSON.stringify(body) }));
}

export async function createRole(businessId: string, input: { name: string; description: string | null; permissions: string[] }, actor: RoleActor, opts: RoleWriteOptions = {}) {
  const perms = input.permissions.filter(isAction);
  assertWithinActor(actor, perms, "A new role can only have permissions your own role has.");
  let key = slugifyKey(input.name) || "role";
  const taken = await withTenant(businessId, (tx) => tx.select({ key: schema.roles.key }).from(schema.roles));
  const keys = new Set(taken.map((t) => t.key));
  if (keys.has(key) || (ROLES as readonly string[]).includes(key)) {
    let i = 2;
    while (keys.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  // Register with Better Auth first so invitations/role changes accept the key.
  if (opts.syncAuth !== false) await auth.api.createOrgRole({ headers: await headers(), body: { organizationId: businessId, role: key, permission: orgPermissionFor(perms) } });
  const [row] = await withTenant(businessId, (tx) =>
    tx.insert(schema.roles).values({ businessId, key, name: input.name, description: input.description, permissions: perms, isSystem: false, sortOrder: 100 }).returning(),
  );
  await audit(businessId, actor.userId, "role.create", "role", row!.id, { name: input.name, permissions: perms }, opts);
  return row!;
}

export async function updateRole(businessId: string, id: string, input: { name: string; description: string | null; permissions: string[] }, actor: RoleActor, opts: RoleWriteOptions = {}) {
  const role = await getRole(businessId, id);
  if (!role) throw new RoleError("Role not found.", "not_found");
  if (role.key === "owner") throw new RoleError("The Owner role can't be changed.");
  const perms = input.permissions.filter(isAction);
  if (actor.role !== "owner" && role.key === actor.role) throw new RoleError("You can't change the permissions of your own role. Ask an owner.", "forbidden");
  const before = new Set(role.permissions);
  const after = new Set<string>(perms);
  const added = perms.filter((p) => !before.has(p));
  const removed = role.permissions.filter((p) => !after.has(p));
  assertWithinActor(actor, [...added, ...removed], "You can only add or remove permissions your own role has.");
  if (role.key !== "owner" && !role.isSystem && opts.syncAuth !== false) {
    await syncOrgRole(businessId, role.key, perms);
  }
  const [row] = await withTenant(businessId, (tx) => tx.update(schema.roles).set({ name: input.name, description: input.description, permissions: perms }).where(eq(schema.roles.id, id)).returning());
  if (added.length || removed.length || role.name !== input.name || role.description !== input.description) await audit(businessId, actor.userId, "role.update", "role", id, { name: input.name, added, removed }, opts);
  return row!;
}

/** Keep Better Auth's dynamic role in step with ours (create if missing). */
async function syncOrgRole(businessId: string, key: string, perms: string[]) {
  const h = await headers();
  const permission = orgPermissionFor(perms);
  try {
    await auth.api.updateOrgRole({ headers: h, body: { organizationId: businessId, roleName: key, data: { permission } } });
  } catch {
    await auth.api.createOrgRole({ headers: h, body: { organizationId: businessId, role: key, permission } }).catch(() => undefined);
  }
}

export async function deleteRole(businessId: string, id: string, actor: RoleActor, opts: RoleWriteOptions = {}) {
  const role = await getRole(businessId, id);
  if (!role) throw new RoleError("Role not found.", "not_found");
  assertWithinActor(actor, role.permissions, "You can't delete a role with permissions your own role doesn't have.");
  if (role.isSystem) throw new RoleError("Built-in roles can't be deleted. You can edit their permissions instead.");
  const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(schema.member).where(and(eq(schema.member.organizationId, businessId), eq(schema.member.role, role.key)));
  const n = Number(cnt?.n ?? 0);
  if (n > 0) throw new RoleError(`${n} member(s) still have this role. Move them to another role first.`);
  if (opts.syncAuth !== false) await auth.api.deleteOrgRole({ headers: await headers(), body: { organizationId: businessId, roleName: role.key } }).catch(() => undefined);
  await withTenant(businessId, (tx) => tx.delete(schema.roles).where(eq(schema.roles.id, id)));
  await audit(businessId, actor.userId, "role.delete", "role", id, { name: role.name, permissions: role.permissions }, opts);
}

/** Members of the business with their login details, for the access screens. */
export async function listMembers(businessId: string) {
  return db
    .select({ id: schema.member.id, userId: schema.member.userId, role: schema.member.role, name: schema.user.name, email: schema.user.email, createdAt: schema.member.createdAt })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, businessId))
    .orderBy(asc(schema.user.name));
}

export async function setMemberRole(businessId: string, memberId: string, roleKey: string, actor: RoleActor) {
  const members = await listMembers(businessId);
  const target = members.find((m) => m.id === memberId);
  if (!target) throw new RoleError("Member not found.", "not_found");
  const blocked = roleChangeBlocker({ actor, target, ownerCount: members.filter((m) => m.role === "owner").length, targetPermissions: await permissionsOfRoleKey(businessId, target.role), toRole: roleKey });
  if (blocked) throw new RoleError(blocked.message, blocked.kind);
  const roles = await listRoles(businessId);
  const role = roles.find((r) => r.key === roleKey);
  if (!role) throw new RoleError("Unknown role.");
  assertWithinActor(actor, role.permissions, "You can't give someone a role with permissions your own role doesn't have.");
  // Write directly: our own guards above are the policy; Better Auth's endpoint would also
  // re-check the actor's org permissions, which built-in roles already satisfy.
  await db.update(schema.member).set({ role: roleKey }).where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, businessId)));
  await audit(businessId, actor.userId, "member.role_change", "member", memberId, { user: target.email, from: target.role, to: roleKey });
}

export async function removeMember(businessId: string, memberId: string, actor: RoleActor) {
  const members = await listMembers(businessId);
  const target = members.find((m) => m.id === memberId);
  if (!target) throw new RoleError("Member not found.");
  if (target.userId === actor.userId) throw new RoleError("You can't remove your own access.");
  if (target.role === "owner" && members.filter((m) => m.role === "owner").length <= 1) throw new RoleError("A business needs at least one owner.");
  if (target.role === "owner" && actor.role !== "owner") throw new RoleError("Only an owner can remove an owner.");
  assertWithinActor(actor, await permissionsOfRoleKey(businessId, target.role), "You can't remove someone whose access is wider than yours.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.member).where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, businessId)));
    await tx.execute(sql`select set_config('app.business_id', ${businessId}, true)`);
    await tx.update(schema.staff).set({ userId: null }).where(eq(schema.staff.userId, target.userId));
  });
  await audit(businessId, actor.userId, "member.remove", "member", memberId, { user: target.email, role: target.role });
}

export const ALL_ACTIONS = ACTIONS;
