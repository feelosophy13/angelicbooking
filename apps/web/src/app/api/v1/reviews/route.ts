import { list, pageParams, probe, route } from "@/lib/api";
import { listReviewsApi, serializeReview } from "@/server/api-v1-more";

/** GET /api/v1/reviews?rating=&staff_id=: submitted reviews, newest first. */
export const GET = route("reviews:read", async (ctx, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const rating = Number(url.searchParams.get("rating"));
  const rows = await listReviewsApi(ctx.business.id, probe(p), { rating: rating >= 1 && rating <= 5 ? Math.floor(rating) : undefined, staffId: url.searchParams.get("staff_id") ?? undefined });
  return list(rows.map(serializeReview), p);
});
