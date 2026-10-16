/**
 * A business's own booking address (book.theirsalon.com): save it, register it with Render so a certificate is issued, and
 * watch until the owner's DNS points at us. Render calls are made only when running on Render, so a laptop can never
 * change the live service by accident.
 */
import { promises as dns } from "node:dns";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { checkHostname, dnsAdvice, ownershipRecord, dnsProblem, looksApex, parseRenderDomain, platformDomains, type DnsAdvice, type DomainStatus, type RenderDomain } from "@/lib/custom-domain";

type Business = typeof schema.businesses.$inferSelect;

export class DomainError extends Error {}

const API = "https://api.render.com/v1";
const FALLBACK_APEX_IP = "216.24.57.1";

function renderEnabled(): boolean {
  return !!process.env.RENDER && !!process.env.RENDER_API_KEY && !!process.env.RENDER_SERVICE_ID;
}

async function render(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  const res = await fetcher(`${API}/services/${process.env.RENDER_SERVICE_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

let targetCache: string | null = null;

/** The hostname owners point their CNAME at: the service's own onrender.com address (asked of Render once), else the app host. */
export async function cnameTarget(): Promise<string> {
  if (process.env.CUSTOM_DOMAIN_CNAME_TARGET) return process.env.CUSTOM_DOMAIN_CNAME_TARGET;
  if (targetCache) return targetCache;
  if (renderEnabled()) {
    try {
      const r = await render("");
      const url = (r.body as { serviceDetails?: { url?: string } } | null)?.serviceDetails?.url;
      if (url) return (targetCache = new URL(url).host);
    } catch { /* fall through */ }
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "app.angelicbooking.com";
}

async function apexIp(target: string): Promise<string> {
  try { return (await dns.resolve4(target))[0] ?? FALLBACK_APEX_IP; } catch { return FALLBACK_APEX_IP; }
}

export async function instructions(host: string, apex?: boolean | null): Promise<DnsAdvice> {
  const target = await cnameTarget();
  return dnsAdvice(host, { cnameTarget: target, apexIp: await apexIp(target), apex: apex ?? undefined });
}

/** This business's ownership token for a hostname (stable, unguessable without the server secret). */
export function ownershipToken(businessId: string, host: string): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`domain:${businessId}:${host}`).digest("hex").slice(0, 32);
}

/** Has the business published its TXT record for the hostname? */
async function provesOwnership(businessId: string, host: string): Promise<boolean> {
  const rec = ownershipRecord(host, ownershipToken(businessId, host));
  const txt = await dns.resolveTxt(rec.fqdn).catch(() => [] as string[][]);
  return txt.some((parts) => parts.join("") === rec.value);
}

async function set(id: string, v: Partial<typeof schema.businesses.$inferInsert>) {
  await db.update(schema.businesses).set(v).where(eq(schema.businesses.id, id));
}

/** Save a new custom address (replacing any old one) and register it with Render. */
export async function connectDomain(b: Business, raw: string): Promise<DomainStatus> {
  const checked = checkHostname(raw, platformDomains(process.env.NEXT_PUBLIC_APP_URL));
  if (!checked.ok) throw new DomainError(checked.message);
  const host = checked.host;
  if (b.customDomain === host && b.customDomainStatus !== "none") return b.customDomainStatus as DomainStatus;
  const taken = await db.query.businesses.findFirst({ where: and(eq(schema.businesses.customDomain, host), ne(schema.businesses.id, b.id)) });
  if (taken) {
    // Someone else claimed it but never proved it was theirs: whoever publishes the ownership record gets it.
    const rec = ownershipRecord(host, ownershipToken(b.id, host));
    if (taken.customDomainStatus === "active" || !(await provesOwnership(b.id, host))) {
      throw new DomainError(taken.customDomainStatus === "active" ? "That address is already connected to another business. If it is yours, contact support." : `That address is waiting for its owner to prove it. If it's yours, add a TXT record named ${rec.name} with the value ${rec.value}, wait a few minutes, then add the address again.`);
    }
    await set(taken.id, { customDomain: null, customDomainStatus: "none", customDomainRenderId: null, customDomainError: `${host} was claimed by its verified owner.` });
    if (b.customDomain) await removeDomain(b);
    await set(b.id, { customDomain: host, customDomainStatus: "pending", customDomainRenderId: taken.customDomainRenderId, customDomainError: null, customDomainCheckedAt: new Date() });
    return checkDomain({ ...b, customDomain: host, customDomainStatus: "pending", customDomainRenderId: taken.customDomainRenderId });
  }
  if (b.customDomain) await removeDomain(b);

  let status: DomainStatus = "manual";
  let renderId: string | null = null;
  let error: string | null = null;
  if (renderEnabled()) {
    const r = await render("/custom-domains", { method: "POST", body: JSON.stringify({ name: host }) });
    if (r.status >= 200 && r.status < 300) {
      const d = parseRenderDomain(r.body, host);
      renderId = d?.id ?? null;
      status = d?.verified ? "active" : "pending";
    } else if (r.status === 409 || r.status === 400) {
      throw new DomainError("Our hosting provider says that address is already in use. Remove it from wherever else it is connected, or contact support.");
    } else {
      throw new DomainError("We couldn't connect that address just now. Please try again in a few minutes.");
    }
  } else {
    error = "Automatic setup isn't available on this server; the platform team will connect it.";
  }
  await set(b.id, { customDomain: host, customDomainStatus: status, customDomainRenderId: renderId, customDomainError: error, customDomainCheckedAt: new Date() });
  return status;
}

async function lookup(host: string) {
  const [seenCname, seenA] = await Promise.all([dns.resolveCname(host).catch(() => [] as string[]), dns.resolve4(host).catch(() => [] as string[])]);
  return { seenCname, seenA };
}

/** Ask Render whether the DNS is right yet, and say what is wrong if not. */
export async function checkDomain(b: Business): Promise<DomainStatus> {
  if (!b.customDomain || b.customDomainStatus === "none") return "none";
  const host = b.customDomain;
  let status = b.customDomainStatus as DomainStatus;
  let apex: boolean | null = null;
  let error: string | null = null;
  if (renderEnabled() && b.customDomainRenderId) {
    try {
      await render(`/custom-domains/${b.customDomainRenderId}/verify`, { method: "POST" });
      const r = await render(`/custom-domains/${b.customDomainRenderId}`);
      if (r.status === 404) { status = "problem"; error = "This address is no longer registered with our hosting provider. Remove it and add it again."; }
      else {
        const d: RenderDomain | null = parseRenderDomain(r.body, host);
        apex = d?.apex ?? null;
        status = d?.verified ? "active" : "pending";
      }
    } catch (e) {
      console.error("[domain] check failed", host, (e as Error).message);
    }
  }
  // Becoming active also needs the ownership record (an address that is already active keeps working).
  if (status === "active" && b.customDomainStatus !== "active" && !(await provesOwnership(b.id, host))) {
    status = "pending";
    const rec = ownershipRecord(host, ownershipToken(b.id, host));
    error = `Almost there: add the TXT record ${rec.name} below so we know the address is yours.`;
  }
  if ((status === "pending" || status === "problem") && !error) {
    const target = await cnameTarget();
    const seen = await lookup(host);
    error = error ?? dnsProblem({ host, cnameTarget: target, seenCname: seen.seenCname, seenA: seen.seenA, apexIp: await apexIp(target), apex: apex ?? looksApex(host) });
  }
  if (status === "active") error = null;
  await set(b.id, { customDomainStatus: status, customDomainError: error, customDomainCheckedAt: new Date() });
  return status;
}

export async function removeDomain(b: Business): Promise<void> {
  if (renderEnabled() && b.customDomainRenderId) {
    try {
      const r = await render(`/custom-domains/${b.customDomainRenderId}`, { method: "DELETE" });
      if (r.status >= 400 && r.status !== 404) console.error("[domain] remove failed", b.customDomain, r.status);
    } catch (e) {
      console.error("[domain] remove failed", b.customDomain, (e as Error).message);
    }
  }
  await set(b.id, { customDomain: null, customDomainStatus: "none", customDomainRenderId: null, customDomainError: null, customDomainCheckedAt: null });
}

/** Called by the 5-minute job: recheck addresses still waiting for DNS (at most every 4 minutes each). */
export async function refreshPendingDomains(limit = 20): Promise<{ checked: number; active: number }> {
  const rows = await db.select().from(schema.businesses).where(and(inArray(schema.businesses.customDomainStatus, ["pending", "problem"]), or(isNull(schema.businesses.customDomainCheckedAt), lt(schema.businesses.customDomainCheckedAt, new Date(Date.now() - 4 * 60_000))))).limit(limit);
  let active = 0;
  for (const b of rows) {
    try {
      if ((await checkDomain(b)) === "active") active++;
    } catch (e) {
      console.error("[domain] refresh failed", b.customDomain, (e as Error).message);
    }
  }
  return { checked: rows.length, active };
}
