import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema, withTenant } from "@angelic/db";
import { auth } from "@/lib/auth";
import { permissionsForRole } from "@/server/roles";
import { businessAccess } from "@/server/access";

/**
 * Mobile requests authenticate with the Better Auth session: the Expo client stores the
 * session cookie in SecureStore and sends it as a Cookie header (an
 * `Authorization: Bearer <session token>` header also works, via the `bearer()` plugin).
 * They name the business by slug.
 */
export async function mobileContext(req: Request, slug: string | null) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const all = await db
    .select({ id: schema.businesses.id, name: schema.businesses.name, slug: schema.businesses.slug, timezone: schema.businesses.timezone, role: schema.member.role, suspendedAt: schema.businesses.suspendedAt })
    .from(schema.member)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.member.organizationId))
    .where(eq(schema.member.userId, session.user.id));
  // A business a platform admin has suspended is closed to the app: say so when it is asked for by name, and leave it out of the list.
  const memberships = all.filter((m) => !m.suspendedAt).map(({ suspendedAt: _s, ...m }) => m);
  if (slug && all.some((m) => m.slug === slug && m.suspendedAt)) return { error: NextResponse.json({ error: "suspended" }, { status: 403 }) } as const;
  const business = slug ? memberships.find((m) => m.slug === slug) : memberships[0];
  if (slug && !business) return { error: NextResponse.json({ error: "not a member" }, { status: 404 }) } as const;
  const bizRow = business ? await db.query.businesses.findFirst({ where: and(eq(schema.businesses.id, business.id)) }) : null;
  // Trial over with no subscription: closed like the staff app until someone subscribes on the web.
  if (bizRow && (await businessAccess(bizRow)).state === "expired") return { error: NextResponse.json({ error: "subscription_required" }, { status: 402 }) } as const;
  const permissions = business ? await permissionsForRole(business.id, business.role) : new Set<never>();
  // The staff member this login works as, for "own calendar only" roles (same rule as the web app).
  const me = business ? await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.userId, session.user.id), columns: { id: true } })) : null;
  return { session, memberships, business: bizRow ?? null, role: business?.role ?? null, permissions, myStaffId: me?.id ?? null } as const;
}
