import { NextResponse } from "next/server";
import { deliverDue } from "@/lib/notify";

/**
 * Deliver due reminders. Call every few minutes from a scheduler
 * (Vercel Cron, DigitalOcean Functions, or `curl` from cron) with
 * `Authorization: Bearer $JOBS_SECRET`.
 */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await deliverDue();
  return NextResponse.json(r);
}

export const GET = POST;
