import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/notify";
import { refreshPendingVerifications } from "@/server/messaging";
import { processWorkflowRuns, runScheduledTriggers } from "@/server/workflows";
import { queueFormsNudges } from "@/server/forms";
import { sendLowStockDigests } from "@/server/inventory";
import { reconcileAllSubscriptions } from "@/server/billing";
import { nudgeAbandonedSignups } from "@/server/onboarding-nudge";
import { refreshPendingDomains } from "@/server/custom-domain";
import { sweepOrphanDeposits } from "@/server/online-payments";
import { sweepHelcimCheckouts } from "@/server/helcim/online";
import { renewHelcimMemberships } from "@/server/membership-billing";
import { sweepAuthorizedOrders } from "@/server/store";
import { runAutoFill } from "@/server/fill-books";
import { jobsAuthorized } from "@/lib/jobs-auth";
import { sql } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { reportError } from "@/lib/report-error";

/**
 * Deliver due reminders. Called every 5 minutes by the Render cron job
 * `angelic-booking-reminders` (see docs-ops.md) with
 * `Authorization: Bearer $JOBS_SECRET`. Safe to call concurrently: rows are
 * claimed atomically before sending.
 */
export async function POST(req: Request) {
  if (!jobsAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  // Start scheduled workflows (birthday, lapsed clients) and resume waiting runs first, so this run
  // can deliver what they queue.
  const a = await runScheduledTriggers().catch((e) => ({ businesses: 0, started: 0, failed: 0, error: (e as Error).message }));
  const w = await processWorkflowRuns().catch((e) => ({ businesses: 0, resumed: 0, queued: 0, failed: 0, error: (e as Error).message }));
  const f = await queueFormsNudges().catch((e) => ({ businesses: 0, queued: 0, error: (e as Error).message }));
  // Once a day (after 8am local), tell whoever manages inventory what is low; queued here so it goes out in this run.
  const inv = await sendLowStockDigests().catch((e) => ({ checked: 0, sent: 0, error: (e as Error).message }));
  // Once a day (the first run from 07:00 UTC), bring each paying business's Stripe items in line with its locations and active staff.
  const now = new Date();
  const bill = now.getUTCHours() >= 7 && (await claimDailyRun("billing-reconcile", now)) ? await reconcileAllSubscriptions().catch((e) => ({ checked: 0, changed: 0, failed: 1, error: (e as Error).message })) : null;
  // Once a day (the first run from 15:00 UTC), one reminder to people who signed up and never created a business.
  const nudge = now.getUTCHours() >= 15 && (await claimDailyRun("onboarding-nudge", now)) ? await nudgeAbandonedSignups().catch((e) => ({ checked: 0, sent: 0, error: (e as Error).message })) : null;
  // Custom booking addresses still waiting for their owner's DNS: recheck (each at most every 4 minutes).
  const domains = await refreshPendingDomains().catch((e) => ({ checked: 0, active: 0, error: (e as Error).message }));
  // Deposits charged for a booking that was never saved (the client's page closed mid-way): refund them.
  const orphans = await sweepOrphanDeposits().catch((e) => ({ checked: 0, refunded: 0, failed: 1, error: (e as Error).message }));
  // The same for Helcim: checkouts paid on the booking page or the store that never became a booking or an order.
  const helcimOrphans = await sweepHelcimCheckouts().catch((e) => ({ checked: 0, refunded: 0, failed: 1, error: (e as Error).message }));
  // Helcim memberships renew from here (Stripe ones renew by subscription): charge those whose period has ended.
  const helcimRenewals = await renewHelcimMemberships().catch((e) => ({ due: 0, renewed: 0, failed: 1, error: (e as Error).message }));
  // Online orders whose card was authorized but the buyer's page never came back: capture if the stock is still there, else release it.
  // Before deliverDue, so the receipt and gift card emails of a captured order go out in this run.
  const orders = await sweepAuthorizedOrders().catch((e) => ({ checked: 0, captured: 0, released: 0, abandoned: 0, failed: 1, error: (e as Error).message }));
  // Fill My Books' automatic mode: once a day per business that turned it on, invitations to open slots (delivered just below).
  const fill = await runAutoFill(now).catch((e) => ({ businesses: 0, sent: 0, failed: 1, error: (e as Error).message }));
  const r = await deliverDue();
  const v = await refreshPendingVerifications().catch((e) => ({ checked: 0, changed: 0, error: (e as Error).message }));
  const ms = Date.now() - started;
  // A step that failed is reported and makes the job answer 500, so the cron's `curl -f` notices instead of the job looking fine.
  const failed = Object.entries({ workflows: a, workflowRuns: w, formsNudges: f, lowStock: inv, billing: bill, onboardingNudge: nudge, customDomains: domains, orphanDeposits: orphans, helcimCheckouts: helcimOrphans, helcimRenewals, authorizedOrders: orders, fillMyBooks: fill, verifications: v })
    .filter(([, r]) => r && typeof r === "object" && "error" in r && (r as { error?: unknown }).error)
    .map(([k, r]) => `${k}: ${(r as { error: string }).error}`);
  if (failed.length) await reportError(`jobs/notifications: ${failed.length} step(s) failed`, undefined, { failed });
  // Heartbeat for /api/health: the cron reached the app and the run finished (with or without failed steps).
  await db.insert(schema.jobMarkers).values({ name: HEARTBEAT, lastRunOn: now.toISOString().slice(0, 10) }).onConflictDoUpdate({ target: schema.jobMarkers.name, set: { lastRunOn: now.toISOString().slice(0, 10), updatedAt: new Date() } }).catch(() => undefined);
  console.log(`[jobs/notifications] processed=${r.processed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped} workflowsStarted=${a.started} workflowsResumed=${w.resumed} workflowsFailed=${a.failed + w.failed} formsNudges=${f.queued} lowStockEmails=${inv.sent} verifications=${v.checked}/${v.changed} in ${ms}ms`);
  return NextResponse.json({ ...r, workflows: { ...a, ...w }, formsNudges: f, lowStock: inv, verifications: v, billing: bill, onboardingNudge: nudge, customDomains: domains, orphanDeposits: orphans, helcimCheckouts: helcimOrphans, helcimRenewals, authorizedOrders: orders, fillMyBooks: fill, failed, ms }, { status: failed.length ? 500 : 200 });
}

/** The job_markers row /api/health reads to know the 5-minute cron is still calling. */
export const HEARTBEAT = "notifications-heartbeat";

/** Claim today's run of a once-a-day job (UTC day). True for exactly one caller per day, however many runs or instances there are. */
async function claimDailyRun(name: string, now: Date): Promise<boolean> {
  const today = now.toISOString().slice(0, 10);
  const rows = await db
    .insert(schema.jobMarkers)
    .values({ name, lastRunOn: today })
    .onConflictDoUpdate({ target: schema.jobMarkers.name, set: { lastRunOn: today, updatedAt: new Date() }, setWhere: sql`${schema.jobMarkers.lastRunOn} < ${today}` })
    .returning({ name: schema.jobMarkers.name });
  return rows.length > 0;
}

export const GET = POST;
