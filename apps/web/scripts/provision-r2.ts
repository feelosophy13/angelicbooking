/**
 * One-time Cloudflare R2 setup through the Cloudflare API (idempotent):
 *   - creates the public and private buckets,
 *   - serves the public one from a custom domain on the same account (e.g. images.angelicbooking.com).
 * Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (R2 edit + zone read/DNS edit), and R2 switched on
 * for the account in the dashboard. The S3 access key and secret (R2 > Manage API tokens) are created in
 * the dashboard and go in R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY; this script does not touch them.
 *
 * Usage (from apps/web):
 *   ../../packages/db/node_modules/.bin/tsx scripts/provision-r2.ts [--domain images.angelicbooking.com] [--public angelicbooking-public] [--private angelicbooking-private]
 */
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback; };
const DOMAIN = arg("domain", "images.angelicbooking.com");
const PUBLIC = arg("public", "angelicbooking-public");
const PRIVATE = arg("private", "angelicbooking-private");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

async function cf(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: any; errors?: { code: number; message: string }[] };
  return { ok: !!json.success, result: json.result, errors: (json.errors ?? []).map((e) => `${e.message} (${e.code})`) };
}

async function main() {
  if (!ACCOUNT || !TOKEN) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  const list = await cf("GET", `/accounts/${ACCOUNT}/r2/buckets`);
  if (!list.ok) throw new Error(`Cannot list R2 buckets: ${list.errors.join("; ")}\nSwitch R2 on in the Cloudflare dashboard (R2 Object Storage) first.`);
  const have = new Set<string>((list.result?.buckets ?? []).map((b: { name: string }) => b.name));
  for (const name of [PUBLIC, PRIVATE]) {
    if (have.has(name)) { console.log(`bucket ${name}: exists`); continue; }
    const r = await cf("POST", `/accounts/${ACCOUNT}/r2/buckets`, { name });
    if (!r.ok) throw new Error(`Could not create ${name}: ${r.errors.join("; ")}`);
    console.log(`bucket ${name}: created`);
  }
  const apex = DOMAIN.split(".").slice(-2).join(".");
  const zones = await cf("GET", `/zones?name=${apex}`);
  const zoneId: string | undefined = zones.result?.[0]?.id;
  if (!zones.ok || !zoneId) throw new Error(`Cannot find the ${apex} zone: ${zones.errors.join("; ") || "not in this account"}`);
  const domains = await cf("GET", `/accounts/${ACCOUNT}/r2/buckets/${PUBLIC}/domains/custom`);
  const existing = (domains.result?.domains ?? []).find((d: { domain: string }) => d.domain === DOMAIN);
  if (existing) console.log(`custom domain ${DOMAIN}: already attached (${existing.status?.ownership ?? "?"}/${existing.status?.ssl ?? "?"})`);
  else {
    const r = await cf("POST", `/accounts/${ACCOUNT}/r2/buckets/${PUBLIC}/domains/custom`, { domain: DOMAIN, zoneId, enabled: true, minTLS: "1.2" });
    if (!r.ok) throw new Error(`Could not attach ${DOMAIN}: ${r.errors.join("; ")}`);
    console.log(`custom domain ${DOMAIN}: attached`);
  }
  console.log(`\nSet these (local .env and Render):\n  R2_ACCOUNT_ID=${ACCOUNT}\n  R2_PUBLIC_BUCKET=${PUBLIC}\n  R2_PRIVATE_BUCKET=${PRIVATE}\n  R2_PUBLIC_BASE_URL=https://${DOMAIN}\n  R2_ACCESS_KEY_ID=<from the dashboard>\n  R2_SECRET_ACCESS_KEY=<from the dashboard>`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
