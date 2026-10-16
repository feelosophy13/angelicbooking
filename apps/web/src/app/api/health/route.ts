import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@angelic/db";

export const dynamic = "force-dynamic";

/** Uptime check: 200 when the app can reach Postgres, 503 when it can't. Says nothing else about the deployment. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
