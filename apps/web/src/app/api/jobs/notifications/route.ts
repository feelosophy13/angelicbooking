import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/notify";

/**
 * Deliver due reminders. Called every 5 minutes by the Render cron job
 * `angelic-booking-reminders` (see docs-ops.md) with
 * `Authorization: Bearer $JOBS_SECRET`. Safe to call concurrently: rows are
 * claimed atomically before sending.
 */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const r = await deliverDue();
  const ms = Date.now() - started;
  console.log(`[jobs/notifications] processed=${r.processed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped} in ${ms}ms`);
  return NextResponse.json({ ...r, ms });
}

export const GET = POST;
