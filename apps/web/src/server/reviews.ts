/**
 * Review requests: after a visit is completed, the client gets a text/email
 * with a one-tap rating link. High ratings are nudged on to Google when the
 * business has a review URL; every rating is kept on the client's record.
 */
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { appointmentFacts, triggerWorkflows } from "@/server/workflows";

type Business = typeof schema.businesses.$inferSelect;

// Review requests are sent by the "Ask for a rating" workflow (server/workflows.ts).

/** Public: the review behind a token, with what to show. */
export async function getReviewByToken(slug: string, token: string) {
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!business) return null;
  return withTenant(business.id, async (tx) => {
    const review = await tx.query.reviews.findFirst({ where: eq(schema.reviews.token, token) });
    if (!review) return null;
    const client = review.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, review.clientId) }) : null;
    const item = review.appointmentId ? await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.appointmentId, review.appointmentId) }) : null;
    const person = review.staffId ? await tx.query.staff.findFirst({ where: eq(schema.staff.id, review.staffId) }) : null;
    return { business, review, client, serviceName: item?.serviceName.replace(" (finish)", "") ?? null, staffName: person?.displayName ?? null };
  });
}

export async function submitReview(businessId: string, token: string, rating: number, comment: string | null) {
  const review = await withTenant(businessId, async (tx) => {
    const review = await tx.query.reviews.findFirst({ where: eq(schema.reviews.token, token) });
    if (!review) throw new Error("Review not found.");
    await tx.update(schema.reviews).set({ rating, comment, submittedAt: new Date() }).where(eq(schema.reviews.id, review.id));
    return review;
  });
  // "Review received" workflows (e.g. low-rating alert to the owner).
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
  if (business && review.clientId) {
    const facts = review.appointmentId ? await withTenant(businessId, (tx) => appointmentFacts(tx, review.appointmentId!)) : null;
    await triggerWorkflows(business, "review_submitted", { clientId: review.clientId, appointmentId: review.appointmentId, dedupeKey: review.id, facts: { ...(facts ?? {}), rating, staffId: review.staffId, locationId: review.locationId }, context: { appointmentId: review.appointmentId, rating, staffId: review.staffId, locationId: review.locationId, reason: `Rated ${rating}/5` } }).catch((e) => console.error("[workflows] review_submitted failed", (e as Error).message));
  }
}

export type ReviewFilter = { locationId?: string | null; staffId?: string | null; from?: Date | null; to?: Date | null };

/** Submitted reviews with summary numbers; every part respects the same filter. */
export async function listReviews(businessId: string, f: ReviewFilter = {}, limit = 200) {
  const conds = [isNotNull(schema.reviews.submittedAt)];
  if (f.locationId) conds.push(eq(schema.reviews.locationId, f.locationId));
  if (f.staffId) conds.push(eq(schema.reviews.staffId, f.staffId));
  if (f.from) conds.push(gte(schema.reviews.submittedAt, f.from));
  if (f.to) conds.push(lt(schema.reviews.submittedAt, f.to));
  const where = and(...conds);
  // "Requested" counts invitations in the same scope, whether or not they were answered.
  const reqConds = [sql`true`];
  if (f.locationId) reqConds.push(eq(schema.reviews.locationId, f.locationId));
  if (f.staffId) reqConds.push(eq(schema.reviews.staffId, f.staffId));
  if (f.from) reqConds.push(gte(schema.reviews.requestedAt, f.from));
  if (f.to) reqConds.push(lt(schema.reviews.requestedAt, f.to));
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ r: schema.reviews, firstName: schema.clients.firstName, lastName: schema.clients.lastName, staffName: schema.staff.displayName, locationName: schema.locations.name })
      .from(schema.reviews)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.reviews.clientId))
      .leftJoin(schema.staff, eq(schema.staff.id, schema.reviews.staffId))
      .leftJoin(schema.locations, eq(schema.locations.id, schema.reviews.locationId))
      .where(where)
      .orderBy(desc(schema.reviews.submittedAt))
      .limit(limit);
    const [agg] = await tx.select({ n: sql<number>`count(*)`, avg: sql<number>`coalesce(avg(${schema.reviews.rating}), 0)` }).from(schema.reviews).where(where);
    const [req] = await tx.select({ n: sql<number>`count(*)` }).from(schema.reviews).where(and(...reqConds));
    const byStaff = await tx
      .select({ staffId: schema.staff.id, staffName: schema.staff.displayName, n: sql<number>`count(*)`, avg: sql<number>`avg(${schema.reviews.rating})` })
      .from(schema.reviews)
      .innerJoin(schema.staff, eq(schema.staff.id, schema.reviews.staffId))
      .where(where)
      .groupBy(schema.staff.id, schema.staff.displayName)
      .orderBy(asc(schema.staff.displayName));
    const dist = await tx.select({ rating: schema.reviews.rating, n: sql<number>`count(*)` }).from(schema.reviews).where(where).groupBy(schema.reviews.rating);
    const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, n: Number(dist.find((d) => d.rating === star)?.n ?? 0) }));
    return { rows, count: Number(agg?.n ?? 0), average: Number(agg?.avg ?? 0), requested: Number(req?.n ?? 0), byStaff: byStaff.map((b) => ({ ...b, n: Number(b.n), avg: Number(b.avg) })), distribution };
  });
}

export async function reviewsForClient(businessId: string, clientId: string) {
  return withTenant(businessId, (tx) => tx.select().from(schema.reviews).where(and(eq(schema.reviews.clientId, clientId), isNotNull(schema.reviews.submittedAt))).orderBy(desc(schema.reviews.submittedAt)));
}
