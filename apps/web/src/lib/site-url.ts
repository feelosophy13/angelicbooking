import { appUrl } from "./stripe";

/**
 * A link to this business's booking site, on its own domain when that is live (custom domains serve /book/<slug>/… as they are), else on
 * ours. `path` is what follows /book/<slug>, e.g. "/manage/<token>".
 */
export function siteUrl(b: { slug: string; customDomain?: string | null; customDomainStatus?: string | null }, path = ""): string {
  const own = b.customDomain && (b.customDomainStatus === "active" || b.customDomainStatus === "manual") ? b.customDomain : null;
  return own ? `https://${own}/book/${b.slug}${path}` : appUrl(`/book/${b.slug}${path}`);
}
