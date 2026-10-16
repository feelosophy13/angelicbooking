import { NextResponse } from "next/server";
import { filesLeftInDatabase, migrateFilesToR2 } from "@/server/files-to-r2";
import { jobsAuthorized } from "@/lib/jobs-auth";

/**
 * One-time job: move pictures and client files from Postgres to Cloudflare R2, `limit` files per call
 * (default 20, at most 100). Call it repeatedly until `left.files` is 0. Same bearer secret as the
 * other jobs; `?dryRun=1` only reports what is left.
 */
export async function POST(req: Request) {
  if (!jobsAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("dryRun")) return NextResponse.json({ left: await filesLeftInDatabase() });
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  try {
    return NextResponse.json(await migrateFilesToR2(limit));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
