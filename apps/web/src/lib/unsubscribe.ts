/**
 * Marketing-email unsubscribe links. Token = client id + HMAC over business and client ids, so a link only works for the client it was
 * sent to. The page lives at /unsubscribe/<slug>/<token> (outside the booking site, so it works even when online booking is off), and
 * mail providers' one-click button POSTs to /api/unsubscribe/<slug>/<token> (RFC 8058).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "./stripe";

type Biz = { id: string; slug: string };

function unsubSig(businessId: string, clientId: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`unsub:${businessId}:${clientId}`).digest("base64url").slice(0, 32);
}

const tokenFor = (business: Biz, clientId: string) => `${clientId}.${unsubSig(business.id, clientId)}`;

export function unsubscribeUrl(business: Biz, clientId: string): string {
  return appUrl(`/unsubscribe/${business.slug}/${tokenFor(business, clientId)}`);
}

export function oneClickUnsubscribeUrl(business: Biz, clientId: string): string {
  return appUrl(`/api/unsubscribe/${business.slug}/${tokenFor(business, clientId)}`);
}

/** The client id an unsubscribe token points at, or null if the signature is wrong. Does not change anything. */
export function verifyUnsubscribe(business: { id: string }, token: string): string | null {
  const [clientId, sig] = token.split(".");
  if (!clientId || !sig) return null;
  const expected = unsubSig(business.id, clientId);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  return clientId;
}
