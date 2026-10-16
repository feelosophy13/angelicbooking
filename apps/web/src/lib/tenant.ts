import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db, schema, withTenant } from "@angelic/db";
import { can, type Action, type Permissions, type Role } from "@angelic/core";
import { cookies, headers } from "next/headers";
import { listRoles, permissionsForRole } from "@/server/roles";
import { VIEW_AS_COOKIE, viewAsEnabled } from "./dev-view-as";
import { requireSession } from "./session";
import { businessAccess } from "@/server/access";

export type TenantContext = {
  business: typeof schema.businesses.$inferSelect;
  role: Role | string;
  /** Resolved from the business's roles table; use with can(). */
  permissions: Permissions;
  user: { id: string; name: string; email: string };
  /** Development only: the role being viewed as, when it is not the person's real one (see lib/dev-view-as.ts). */
  viewingAs?: string | null;
  realRole?: string;
  /** The staff member this login is (staff.user_id), or the one being viewed as in development; null when the login is not linked to one. */
  staffId?: string | null;
  /** Trial / subscription state: "trial" shows a banner, "expired" is only seen on the billing and locked pages. */
  plan: import("./access").Access;
};

/**
 * Resolve the tenant for an /app/[slug] route and prove the signed-in user is
 * a member. Non-members get a 404 so business existence is not leaked.
 * The tenant id is ONLY ever derived here, server-side.
 */
export const requireBusiness = cache(async (slug: string): Promise<TenantContext> => {
  const session = await requireSession();
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business) notFound();
  const membership = await db.query.member.findFirst({
    where: and(eq(schema.member.organizationId, business.id), eq(schema.member.userId, session.user.id)),
  });
  if (!membership) notFound();
  // Closed by a platform admin (apps/admin): nothing in the staff app works until they reopen it.
  if (business.suspendedAt) redirect("/suspended");
  // Trial over and no subscription: the staff app is closed except the billing page and the locked page, where they can subscribe.
  const access = await businessAccess(business);
  if (access.state === "expired") {
    const path = (await headers()).get("x-pathname") ?? "";
    const open = [`/app/${slug}/settings/billing`, `/app/${slug}/locked`].some((p) => path === p || path.startsWith(`${p}/`));
    if (!open) redirect(`/app/${slug}/locked`);
  }
  const myStaff = await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.userId, session.user.id), columns: { id: true } }));
  // Development only: act as another role (optionally as a particular staff member: "provider:<staffId>"), so every page and permission check
  // shows what that person gets.
  if (viewAsEnabled()) {
    const [as, asStaff] = ((await cookies()).get(VIEW_AS_COOKIE)?.value ?? "").split(":");
    if (as && (as !== membership.role || asStaff) && (await listRoles(business.id)).some((r) => r.key === as)) {
      return { business, role: as, permissions: await permissionsForRole(business.id, as), user: session.user, viewingAs: as, realRole: membership.role, staffId: asStaff || myStaff?.id || null, plan: access };
    }
  }
  const permissions = await permissionsForRole(business.id, membership.role);
  return { business, role: membership.role, permissions, user: session.user, viewingAs: null, realRole: membership.role, staffId: myStaff?.id ?? null, plan: access };
});

export const PERMISSION_DENIED = "PERMISSION_DENIED";

/** Next.js strips server error messages in production but forwards `digest`, so the boundary keys on that. */
export class PermissionError extends Error {
  digest = PERMISSION_DENIED;
  constructor() {
    super("You don't have permission to do that.");
  }
}

export async function requireAction(slug: string, action: Action): Promise<TenantContext> {
  const ctx = await requireBusiness(slug);
  if (!can(ctx.permissions, action)) throw new PermissionError();
  return ctx;
}

/** All businesses the current user belongs to (for the switcher / landing redirect). */
export async function listMyBusinesses(userId: string) {
  return db
    .select({ id: schema.businesses.id, name: schema.businesses.name, slug: schema.businesses.slug, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId));
}

/** The acting person, for role and access changes (server/roles.ts checks nobody grants more than this). */
export function roleActor(ctx: TenantContext) {
  return { userId: ctx.user.id, role: String(ctx.role), permissions: ctx.permissions };
}
