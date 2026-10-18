import { NextResponse } from "next/server";
import { requireAction } from "@/lib/tenant";
import { asFilter } from "@/lib/inbox";
import { listConversations } from "@/server/inbound";

/**
 * Backs the live inbox: the conversation list polls it with its search and filter, and the
 * sidebar badge asks for the count alone (`?count=1`). Same permission as the inbox page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "clients.messages");
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("n")) || 50, 50), 1000);
  const r = await listConversations(business.id, { q: sp.get("q") ?? "", filter: asFilter(sp.get("f")), limit: sp.get("count") ? 1 : limit });
  return NextResponse.json(sp.get("count") ? { unread: r.unread } : r, { headers: { "Cache-Control": "no-store" } });
}
