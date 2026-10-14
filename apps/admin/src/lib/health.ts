import "server-only";
import { sql } from "drizzle-orm";
import { adminDb } from "./db";
import { requireAdmin } from "./admin";
import { revive } from "./rows";

export type PlatformHealth = {
  queuedOverdue: number;
  oldestQueuedMinutes: number | null;
  failed24h: { channel: string; n: number }[];
  topErrors: { error: string; n: number }[];
  webhookErrors: { id: string; type: string; error: string; at: Date }[];
  webhookUnprocessed: number;
  signups: { week: Date; n: number }[];
};

export async function platformHealth(): Promise<PlatformHealth> {
  await requireAdmin();
  const db = adminDb();
  const [overdue, failed, errors, hooks, unprocessed, signups] = await Promise.all([
    db.execute(sql`select count(*)::int as n, (extract(epoch from now() - min(scheduled_at)) / 60)::int as oldest from notifications where status = 'queued' and scheduled_at < now() - interval '15 minutes'`),
    db.execute(sql`select channel::text as channel, count(*)::int as n from notifications where status = 'failed' and created_at > now() - interval '24 hours' group by channel`),
    db.execute(sql`select left(error, 140) as error, count(*)::int as n from notifications where status = 'failed' and created_at > now() - interval '7 days' and error is not null group by 1 order by n desc limit 5`),
    db.execute(sql`select id, type, error, received_at as at from webhook_events where error is not null and received_at > now() - interval '7 days' order by received_at desc limit 10`),
    db.execute(sql`select count(*)::int as n from webhook_events where processed_at is null and error is null and received_at < now() - interval '10 minutes'`),
    db.execute(sql`select date_trunc('week', created_at) as week, count(*)::int as n from businesses where created_at > now() - interval '12 weeks' group by 1 order by 1`),
  ]);
  const o = (overdue as unknown as { n: number; oldest: number | null }[])[0];
  return {
    queuedOverdue: o?.n ?? 0,
    oldestQueuedMinutes: o?.oldest ?? null,
    failed24h: failed as unknown as { channel: string; n: number }[],
    topErrors: errors as unknown as { error: string; n: number }[],
    webhookErrors: revive<PlatformHealth["webhookErrors"][number]>(hooks, ["at"]),
    webhookUnprocessed: (unprocessed as unknown as { n: number }[])[0]?.n ?? 0,
    signups: revive<{ week: Date; n: number }>(signups, ["week"]),
  };
}
