import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/notify";
import { refreshPendingVerifications } from "@/server/messaging";
import { processWorkflowRuns, runScheduledTriggers } from "@/server/workflows";
import { queueFormsNudges } from "@/server/forms";
import { sendLowStockDigests } from "@/server/inventory";
import { reconcileAllSubscriptions } from "@/server/billing";
import { nudgeAbandonedSignups } from "@/server/onboarding-nudge";

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
  // Start scheduled workflows (birthday, lapsed clients) and resume waiting runs first, so this run
  // can deliver what they queue.
  const a = await runScheduledTriggers().catch((e) => ({ businesses: 0, started: 0, error: (e as Error).message }));
  const w = await processWorkflowRuns().catch((e) => ({ businesses: 0, resumed: 0, queued: 0, error: (e as Error).message }));
  const f = await queueFormsNudges().catch((e) => ({ businesses: 0, queued: 0, error: (e as Error).message }));
  // Once a day (after 8am local), tell whoever manages inventory what is low; queued here so it goes out in this run.
  const inv = await sendLowStockDigests().catch((e) => ({ checked: 0, sent: 0, error: (e as Error).message }));
  // Once a day (the 07:00 UTC run), bring each paying business's Stripe items in line with its locations and active staff.
  const now = new Date();
  const bill = now.getUTCHours() === 7 && now.getUTCMinutes() < 5 ? await reconcileAllSubscriptions().catch((e) => ({ checked: 0, changed: 0, failed: 1, error: (e as Error).message })) : null;
  // Once a day (the 15:00 UTC run), one reminder to people who signed up and never created a business.
  const nudge = now.getUTCHours() === 15 && now.getUTCMinutes() < 5 ? await nudgeAbandonedSignups().catch((e) => ({ checked: 0, sent: 0, error: (e as Error).message })) : null;
  const r = await deliverDue();
  const v = await refreshPendingVerifications().catch((e) => ({ checked: 0, changed: 0, error: (e as Error).message }));
  const ms = Date.now() - started;
  console.log(`[jobs/notifications] processed=${r.processed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped} workflowsStarted=${a.started} workflowsResumed=${w.resumed} formsNudges=${f.queued} lowStockEmails=${inv.sent} verifications=${v.checked}/${v.changed} in ${ms}ms`);
  return NextResponse.json({ ...r, workflows: { ...a, ...w }, formsNudges: f, lowStock: inv, verifications: v, billing: bill, onboardingNudge: nudge, ms });
}

export const GET = POST;
