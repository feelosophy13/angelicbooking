import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/notify";
import { refreshPendingVerifications } from "@/server/messaging";
import { runAutomations } from "@/server/marketing";

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
  // Queue automated marketing first so this run can deliver what is due now.
  const a = await runAutomations().catch((e) => ({ businesses: 0, queued: 0, error: (e as Error).message }));
  const r = await deliverDue();
  const v = await refreshPendingVerifications().catch((e) => ({ checked: 0, changed: 0, error: (e as Error).message }));
  const ms = Date.now() - started;
  console.log(`[jobs/notifications] processed=${r.processed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped} automations=${a.queued} verifications=${v.checked}/${v.changed} in ${ms}ms`);
  return NextResponse.json({ ...r, automations: a, verifications: v, ms });
}

export const GET = POST;
