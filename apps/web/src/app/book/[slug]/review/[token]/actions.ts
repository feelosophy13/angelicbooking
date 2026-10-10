"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { getReviewByToken, submitReview } from "@/server/reviews";

export type ReviewState = { error?: string; ok?: boolean; rating?: number } | undefined;

export async function submitReviewAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const d = z.object({ slug: z.string(), token: z.string().min(10), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Pick a star rating." };
  const r = await getReviewByToken(d.data.slug, d.data.token);
  if (!r) return { error: "This link is no longer valid." };
  await submitReview(r.business.id, d.data.token, d.data.rating, d.data.comment || null);
  return { ok: true, rating: d.data.rating };
}

export async function optOutOfReviews(slug: string, token: string) {
  const r = await getReviewByToken(slug, token);
  if (!r?.client) return;
  await withTenant(r.business.id, (tx) => tx.update(schema.clients).set({ reviewOptOut: true }).where(eq(schema.clients.id, r.client!.id)));
}
