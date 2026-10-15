import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { API_SCOPES, expandScopes } from "@/lib/api-scopes";
import { dateTime } from "@/lib/format";
import { BackLink, Card, LinkButton, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { revokeApiKey } from "./actions";

export const metadata: Metadata = { title: "API access" };

const DAY = 86_400_000;
/** Revoked keys drop off the list after this long, so the list stays about what is in use. */
const REVOKED_SHOWN_DAYS = 30;
/** Keys expiring inside this window get a warning. */
const EXPIRY_WARNING_DAYS = 14;

/** "Catalog (read) · Clients (read & change)": one phrase per group, not one per scope. A key made before the finer scopes shows what it really holds. */
function describeScopes(scopes: string[], version: number): string {
  const byGroup = new Map<string, { change: boolean }>();
  for (const scope of expandScopes(scopes, version)) {
    const group = API_SCOPES.find((x) => x.scope === scope)?.group ?? "Other";
    const g = byGroup.get(group) ?? { change: false };
    if (!scope.endsWith(":read")) g.change = true;
    byGroup.set(group, g);
  }
  return [...byGroup].map(([group, g]) => `${group} (${g.change ? "read & change" : "read"})`).join(" · ");
}

/** Keys for the REST API: see what is in use, replace, or revoke. Creating a key is on its own page. */
export default async function ApiAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const tz = business.timezone;
  const all = await withTenant(business.id, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.businessId, business.id)).orderBy(desc(schema.apiKeys.createdAt)));
  const now = new Date();
  const shown = all.filter((k) => !k.revokedAt || k.revokedAt.getTime() > now.getTime() - REVOKED_SHOWN_DAYS * DAY);
  const hiddenRevoked = all.length - shown.length;
  const when = (d: Date | null) => (d ? dateTime(d, tz) : null);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="API access">
        <LinkButton href="/developers" target="_blank" variant="secondary">API documentation</LinkButton>
        <LinkButton href={`/app/${slug}/settings/api/new`} variant="primary">New key</LinkButton>
      </PageHeader>
      <div className="space-y-6">
        <Card>
          {all.length === 0 ? (
            <div className="space-y-3 p-6 text-sm text-stone-500">
              <p>No keys yet. A key lets your own software read and manage {business.name}: a website, a spreadsheet, Zapier.</p>
              <LinkButton href={`/app/${slug}/settings/api/new`} variant="primary" size="sm">Create your first key</LinkButton>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {shown.map((k) => {
                const expired = !!k.expiresAt && k.expiresAt <= now;
                const state = k.revokedAt ? "Revoked" : expired ? "Expired" : null;
                const daysLeft = k.expiresAt && !state ? Math.ceil((k.expiresAt.getTime() - now.getTime()) / DAY) : null;
                const expiringSoon = daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS;
                return (
                  <li key={k.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${state ? "text-stone-400" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{k.name} {state ? <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal">{state}</span> : null}</div>
                      <div className="text-xs text-stone-500">{describeScopes(k.scopes, k.scopeVersion)} · <code>{k.prefix}…</code>{k.allowedIps.length ? ` · only from ${k.allowedIps.length === 1 ? k.allowedIps[0] : `${k.allowedIps.length} addresses`}` : ""}{k.rateLimitPerMin ? ` · ${k.rateLimitPerMin}/min` : ""}</div>
                      <div className="text-xs text-stone-500">Created {when(k.createdAt)} · {k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : "never used"}{k.expiresAt && !state ? ` · expires ${when(k.expiresAt)}` : ""}</div>
                      {expiringSoon ? <div className="mt-0.5 text-xs font-medium text-amber-700">{daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}. Replace it before then.</div> : null}
                    </div>
                    {!state ? (
                      <div className="flex items-center gap-1">
                        <LinkButton href={`/app/${slug}/settings/api/new?replace=${k.id}`} variant="ghost" size="sm">Replace</LinkButton>
                        <form action={revokeApiKey}>
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={k.id} />
                          <ConfirmSubmit title={`Revoke “${k.name}”?`} body="Anything using this key stops working immediately. This can't be undone." confirmLabel="Revoke" variant="ghost" className="text-stone-500 hover:text-red-600">Revoke</ConfirmSubmit>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {hiddenRevoked > 0 ? <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">{hiddenRevoked} key{hiddenRevoked === 1 ? "" : "s"} revoked more than {REVOKED_SHOWN_DAYS} days ago {hiddenRevoked === 1 ? "is" : "are"} not listed.</p> : null}
        </Card>
        <Disclosure title="How keys are protected" hint="Read this before sharing one">
          <ul className="list-disc space-y-1 pl-5 text-xs text-stone-600">
            <li>A key only ever reaches {business.name}. It cannot see or change any other business.</li>
            <li>We store a fingerprint of the key, not the key. We can't show it again.</li>
            <li>Give each tool its own key with the fewest permissions it needs, so you can revoke one without breaking the rest.</li>
            <li>Changes made through a key appear in the <a className="underline" href={`/app/${slug}/settings/audit`}>activity log</a>.</li>
          </ul>
        </Disclosure>
      </div>
    </>
  );
}
