/** Rules for a business's own booking hostname (book.theirsalon.com). Pure, so it is unit tested; server/custom-domain.ts does the rest. */

export type DomainStatus = "none" | "pending" | "active" | "problem" | "manual";

/** "https://Book.MySalon.com/anything:443" → "book.mysalon.com". */
export function normalizeHostname(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const FORBIDDEN_SUFFIX = [".local", ".internal", ".localhost", ".onrender.com", ".invalid", ".example"];

/**
 * Can this hostname be someone's booking address? Rejects what could never work or would be dangerous: IP addresses, local names,
 * Render's own addresses, and the platform's own domain (so nobody can claim admin.angelicbooking.com or app.angelicbooking.com).
 */
export function checkHostname(raw: string, platformDomains: string[]): { ok: true; host: string } | { ok: false; message: string } {
  const host = normalizeHostname(raw);
  if (!host) return { ok: false, message: "Enter a hostname like book.yoursalon.com." };
  if (host.length > 253) return { ok: false, message: "That hostname is too long." };
  const labels = host.split(".");
  if (labels.length < 2) return { ok: false, message: "Enter a full hostname like book.yoursalon.com." };
  if (labels.every((l) => /^\d+$/.test(l))) return { ok: false, message: "Use a name, not an IP address." };
  if (!labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return { ok: false, message: "Enter a hostname like book.yoursalon.com (letters, numbers and hyphens)." };
  if (host === "localhost" || FORBIDDEN_SUFFIX.some((s) => host.endsWith(s))) return { ok: false, message: "That kind of address can't be used." };
  for (const d of platformDomains.map(normalizeHostname).filter(Boolean)) {
    if (host === d || host.endsWith(`.${d}`)) return { ok: false, message: "That address belongs to Angelic Booking. Use your own domain." };
  }
  return { ok: true, host };
}

/** The platform's own domains: the app host's registrable domain plus anything listed, so their subdomains are off limits. */
export function platformDomains(appUrl: string | undefined, extra: string[] = ["angelicbooking.com"]): string[] {
  const out = new Set(extra);
  const host = normalizeHostname(appUrl ?? "");
  if (host && !/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host)) out.add(host.split(".").slice(-2).join("."));
  return [...out];
}

/** How many trailing labels make the domain a person registers: 2 (yoursalon.com), or 3 for common two-part endings (yoursalon.co.uk). */
export function registrableLabels(host: string): number {
  const l = host.split(".");
  return l.length >= 3 && l[l.length - 1]!.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or"].includes(l[l.length - 2]!) ? 3 : 2;
}

/** A bare domain (an "apex") cannot hold a CNAME. Render's own answer wins over this guess when we have it. */
export function looksApex(host: string): boolean {
  return host.split(".").length <= registrableLabels(host);
}

export type DnsAdvice = { type: "CNAME" | "A"; name: string; value: string; note: string };

export function dnsAdvice(host: string, o: { cnameTarget: string; apexIp: string; apex?: boolean }): DnsAdvice {
  const apex = o.apex ?? looksApex(host);
  if (apex) return { type: "A", name: "@", value: o.apexIp, note: "Your domain has no sub-name, so it needs an A record (some providers call it ALIAS or ANAME and accept the address below instead)." };
  return { type: "CNAME", name: host.split(".").slice(0, -registrableLabels(host)).join("."), value: o.cnameTarget, note: "If you use Cloudflare, set this record to \"DNS only\" (grey cloud) until it shows Active." };
}

/** The TXT record that proves a business controls a hostname: its name (as entered at most DNS providers) and the full DNS name. */
export function ownershipRecord(host: string, token: string): { type: "TXT"; name: string; fqdn: string; value: string } {
  const sub = host.split(".").slice(0, -registrableLabels(host)).join(".");
  return { type: "TXT", name: sub ? `_angelic-verify.${sub}` : "_angelic-verify", fqdn: `_angelic-verify.${host}`, value: `angelic-verify=${token}` };
}

/** How the owner sees each status. */
export const STATUS_LABEL: Record<DomainStatus, string> = {
  none: "Not set",
  pending: "Waiting for your DNS",
  active: "Active",
  problem: "Needs attention",
  manual: "Being set up by us",
};

export type RenderDomain = { id: string; name: string; verified: boolean; apex: boolean | null };

/** Render's reply to "add a custom domain" is a list (an apex also adds its www twin) or one object; pick ours. */
export function parseRenderDomain(body: unknown, host: string): RenderDomain | null {
  const list = (Array.isArray(body) ? body : [body]).map((x) => ((x as Record<string, unknown> | null)?.customDomain ?? x) as Record<string, unknown>);
  const d = list.find((x) => x && x.name === host) ?? list[0];
  if (!d || typeof d.id !== "string") return null;
  return { id: d.id, name: String(d.name ?? host), verified: d.verificationStatus === "verified", apex: d.domainType === "apex" ? true : d.domainType === "subdomain" ? false : null };
}

/** What to tell the owner when their DNS is not right yet. `seen` is what the world sees for the hostname. */
export function dnsProblem(o: { host: string; cnameTarget: string; seenCname: string[]; seenA: string[]; apexIp: string; apex: boolean }): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");
  if (o.apex) {
    if (o.seenA.includes(o.apexIp)) return null;
    return o.seenA.length ? `${o.host} points at ${o.seenA.join(", ")}. It should point at ${o.apexIp}.` : `We can't see an A record for ${o.host} yet. DNS changes can take up to an hour.`;
  }
  const cnames = o.seenCname.map(norm);
  if (cnames.includes(norm(o.cnameTarget))) return null;
  if (cnames.length) return `${o.host} points at ${cnames[0]}. It should point at ${o.cnameTarget}.`;
  return o.seenA.length ? `${o.host} has an A record, but needs a CNAME to ${o.cnameTarget}.` : `We can't see a CNAME for ${o.host} yet. DNS changes can take up to an hour.`;
}
