import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";

export const dynamic = "force-dynamic";

/** How long the reminders cron (every 5 minutes) may go quiet before the health check calls it stale. */
const STALE_AFTER_MS = 20 * 60_000;
const HEARTBEAT = "notifications-heartbeat";

/**
 * Uptime check: 200 when the app can reach Postgres and the reminders cron has run recently, 503 otherwise.
 * `reminders` says which: "ok", "stale" (no run in 20 minutes) or "never" (no run recorded yet, e.g. a fresh database).
 * Says nothing else about the deployment.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    await db.execute(sql`select 1`);
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503, headers });
  }
  const mark = await db.query.jobMarkers.findFirst({ where: eq(schema.jobMarkers.name, HEARTBEAT) }).catch(() => null);
  const reminders = !mark ? "never" : Date.now() - mark.updatedAt.getTime() > STALE_AFTER_MS ? "stale" : "ok";
  // A database with no heartbeat yet is still healthy for a few minutes after the first deploy; only a missed run is a failure.
  const ok = reminders !== "stale";
  return NextResponse.json({ ok, reminders, lastRun: mark?.updatedAt ?? null }, { status: ok ? 200 : 503, headers });
}
