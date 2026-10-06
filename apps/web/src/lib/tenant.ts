import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@angelic/db";
import { can, type Action, type Role } from "@angelic/core";
import { requireSession } from "./session";

export type TenantContext = {
  business: typeof schema.businesses.$inferSelect;
  role: Role | string;
  user: { id: string; name: string; email: string };
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
  return { business, role: membership.role, user: session.user };
});

export async function requireAction(slug: string, action: Action): Promise<TenantContext> {
  const ctx = await requireBusiness(slug);
  if (!can(ctx.role, action)) throw new Error("You don't have permission to do that.");
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
