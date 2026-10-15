import { sql } from "drizzle-orm";
import { db } from "@angelic/db";
import { rateLimit } from "./rate-limit";

export type RateResult = { ok: boolean; limit: number; remaining: number; retryAfterSec: number; resetAt: number };

let warnedFallback = false;

/**
 * The same fixed window, counted in the shared database so every instance agrees. One upsert per call. If the database cannot be
 * reached, falls back to the in-process counter rather than failing the request.
 */
export async function sharedRateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const rows = (await db.execute(sql`
      insert into api_rate_limits as r (key, count, reset_at)
      values (${key}, 1, now() + ${windowSec} * interval '1 second')
      on conflict (key) do update set
        count = case when r.reset_at <= now() then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= now() then excluded.reset_at else r.reset_at end
      returning count, extract(epoch from r.reset_at) as reset_epoch
    `)) as unknown as { count: number; reset_epoch: number | string }[];
    const row = rows[0]!;
    // Sweep expired windows now and then, so the table stays small without a separate job.
    if (Math.random() < 0.01) void db.execute(sql`delete from api_rate_limits where reset_at < now() - interval '1 day'`).catch(() => {});
    const resetAt = Math.ceil(Number(row.reset_epoch));
    return {
      ok: row.count <= limit,
      limit,
      remaining: Math.max(0, limit - row.count),
      retryAfterSec: Math.max(1, resetAt - Math.floor(Date.now() / 1000)),
      resetAt,
    };
  } catch (e) {
    if (!warnedFallback) console.error("[rate-limit] shared store unavailable, counting in memory:", (e as Error).message);
    warnedFallback = true;
    const local = rateLimit(key, limit, windowMs);
    return { ...local, limit, resetAt: Math.ceil((Date.now() + local.retryAfterSec * 1000) / 1000) };
  }
}

