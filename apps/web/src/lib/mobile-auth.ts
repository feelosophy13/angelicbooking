import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@angelic/db";
import { auth } from "@/lib/auth";

/**
 * Mobile requests authenticate with the Better Auth session token as a Bearer
 * header (the Expo client stores it securely) and name the business by slug.
 */
export async function mobileContext(req: Request, slug: string | null) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  const memberships = await db
    .select({ id: schema.businesses.id, name: schema.businesses.name, slug: schema.businesses.slug, timezone: schema.businesses.timezone, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.member.organizationId))
    .where(eq(schema.member.userId, session.user.id));
  const business = slug ? memberships.find((m) => m.slug === slug) : memberships[0];
  if (slug && !business) return { error: NextResponse.json({ error: "not a member" }, { status: 404 }) } as const;
  const bizRow = business ? await db.query.businesses.findFirst({ where: and(eq(schema.businesses.id, business.id)) }) : null;
  return { session, memberships, business: bizRow ?? null, role: business?.role ?? null } as const;
}
