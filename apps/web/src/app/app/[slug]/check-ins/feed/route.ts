import { NextResponse } from "next/server";
import { requireAction } from "@/lib/tenant";
import { kioskAlerts } from "@/server/checkin-kiosk";

/**
 * Backs the staff app's live check-in alert: kiosk check-ins and walk-ins after `since` (epoch ms, at most an hour back). Only for
 * people who may see every calendar, since the alert names the client.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "appointments.read.any");
  const raw = Number(new URL(req.url).searchParams.get("since"));
  const since = new Date(Math.max(Number.isFinite(raw) ? raw : 0, Date.now() - 3_600_000));
  return NextResponse.json({ now: Date.now(), alerts: await kioskAlerts(business, since) }, { headers: { "Cache-Control": "no-store" } });
}
