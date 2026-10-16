import { getBusinessForLinks } from "@/server/public-booking";
import { applyUnsubscribe } from "@/server/marketing";

/**
 * One-click unsubscribe (RFC 8058): Gmail, Yahoo and Apple Mail POST here from their own "Unsubscribe" button, named in the
 * List-Unsubscribe header of every marketing email. No page, no confirmation; a GET does nothing (scanners follow links).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getBusinessForLinks(slug);
  if (!business || !(await applyUnsubscribe(business, token))) return new Response("Not found", { status: 404 });
  return new Response("Unsubscribed", { status: 200 });
}
