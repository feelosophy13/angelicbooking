import { and, asc, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema, withTenant } from "@angelic/db";
import { ACTIONS, DEFAULT_ROLE_META, DEFAULT_ROLE_PERMISSIONS, ROLES, isAction, type Action, type Permissions } from "@angelic/core";
import { auth } from "@/lib/auth";

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

export class RoleError extends Error {}

export async function createRole(businessId: string, input: { name: string; description: string | null; permissions: string[] }) {
  const perms = input.permissions.filter(isAction);
  let key = slugifyKey(input.name) || "role";
  const taken = await withTenant(businessId, (tx) => tx.select({ key: schema.roles.key }).from(schema.roles));
  const keys = new Set(taken.map((t) => t.key));
  if (keys.has(key) || (ROLES as readonly string[]).includes(key)) {
    let i = 2;
    while (keys.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  // Register with Better Auth first so invitations/role changes accept the key.
  await auth.api.createOrgRole({ headers: await headers(), body: { organizationId: businessId, role: key, permission: orgPermissionFor(perms) } });
  const [row] = await withTenant(businessId, (tx) =>
    tx.insert(schema.roles).values({ businessId, key, name: input.name, description: input.description, permissions: perms, isSystem: false, sortOrder: 100 }).returning(),
  );
  return row!;
}

export async function updateRole(businessId: string, id: string, input: { name: string; description: string | null; permissions: string[] }) {
  const role = await getRole(businessId, id);
  if (!role) throw new RoleError("Role not found.");
  if (role.key === "owner") throw new RoleError("The Owner role can't be changed.");
  const perms = input.permissions.filter(isAction);
  if (role.key !== "owner" && !role.isSystem) {
    await syncOrgRole(businessId, role.key, perms);
  }
  await withTenant(businessId, (tx) => tx.update(schema.roles).set({ name: input.name, description: input.description, permissions: perms }).where(eq(schema.roles.id, id)));
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

export async function deleteRole(businessId: string, id: string) {
  const role = await getRole(businessId, id);
  if (!role) throw new RoleError("Role not found.");
  if (role.isSystem) throw new RoleError("Built-in roles can't be deleted. You can edit their permissions instead.");
  const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(schema.member).where(and(eq(schema.member.organizationId, businessId), eq(schema.member.role, role.key)));
  const n = Number(cnt?.n ?? 0);
  if (n > 0) throw new RoleError(`${n} member(s) still have this role. Move them to another role first.`);
  await auth.api.deleteOrgRole({ headers: await headers(), body: { organizationId: businessId, roleName: role.key } }).catch(() => undefined);
  await withTenant(businessId, (tx) => tx.delete(schema.roles).where(eq(schema.roles.id, id)));
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

export async function setMemberRole(businessId: string, memberId: string, roleKey: string, actorUserId: string) {
  const members = await listMembers(businessId);
  const target = members.find((m) => m.id === memberId);
  if (!target) throw new RoleError("Member not found.");
  const owners = members.filter((m) => m.role === "owner");
  if (target.role === "owner" && roleKey !== "owner" && owners.length <= 1) throw new RoleError("A business needs at least one owner.");
  const actor = members.find((m) => m.userId === actorUserId);
  if (roleKey === "owner" && actor?.role !== "owner") throw new RoleError("Only an owner can make someone an owner.");
  if (target.role === "owner" && actor?.role !== "owner") throw new RoleError("Only an owner can change another owner's role.");
  const roles = await listRoles(businessId);
  if (!roles.some((r) => r.key === roleKey)) throw new RoleError("Unknown role.");
  // Write directly: our own guards above are the policy; Better Auth's endpoint would also
  // re-check the actor's org permissions, which built-in roles already satisfy.
  await db.update(schema.member).set({ role: roleKey }).where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, businessId)));
}

export async function removeMember(businessId: string, memberId: string, actorUserId: string) {
  const members = await listMembers(businessId);
  const target = members.find((m) => m.id === memberId);
  if (!target) throw new RoleError("Member not found.");
  if (target.userId === actorUserId) throw new RoleError("You can't remove your own access.");
  if (target.role === "owner" && members.filter((m) => m.role === "owner").length <= 1) throw new RoleError("A business needs at least one owner.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.member).where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, businessId)));
    await tx.execute(sql`select set_config('app.business_id', ${businessId}, true)`);
    await tx.update(schema.staff).set({ userId: null }).where(eq(schema.staff.userId, target.userId));
  });
}

export const ALL_ACTIONS = ACTIONS;
