import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, LinkButton, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { ApiKeyForm } from "./key-form";
import { revokeApiKey } from "./actions";

export const metadata: Metadata = { title: "API access" };

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null);

/** Keys for the REST API: create (secret shown once), see last use, revoke. */
export default async function ApiAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const keys = await withTenant(business.id, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.businessId, business.id)).orderBy(desc(schema.apiKeys.createdAt)));
  const now = new Date();
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="API access"><LinkButton href="/developers" target="_blank" variant="secondary">API documentation</LinkButton></PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          {keys.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">No keys yet. Create one to read and manage {business.name} from your own software.</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {keys.map((k) => {
                const expired = !!k.expiresAt && k.expiresAt <= now;
                const state = k.revokedAt ? "Revoked" : expired ? "Expired" : null;
                return (
                  <li key={k.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${state ? "text-stone-400" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{k.name} {state ? <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal">{state}</span> : null}</div>
                      <div className="truncate text-xs text-stone-500"><code>{k.prefix}…</code> · {k.scopes.join(", ")}</div>
                      <div className="text-xs text-stone-500">Created {when(k.createdAt)} · {k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : "never used"}{k.expiresAt && !state ? ` · expires ${when(k.expiresAt)}` : ""}</div>
                    </div>
                    {!state ? (
                      <form action={revokeApiKey}>
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={k.id} />
                        <ConfirmSubmit title={`Revoke “${k.name}”?`} body="Anything using this key stops working immediately. This can't be undone." confirmLabel="Revoke" variant="ghost" className="text-stone-500 hover:text-red-600">Revoke</ConfirmSubmit>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-4"><h2 className="mb-3 text-sm font-semibold">New key</h2><ApiKeyForm slug={slug} /></Card>
          <Disclosure title="How keys are protected" hint="Read this before sharing one">
            <ul className="list-disc space-y-1 pl-5 text-xs text-stone-600">
              <li>A key only ever reaches {business.name}. It cannot see or change any other business.</li>
              <li>We store a fingerprint of the key, not the key. We can't show it again.</li>
              <li>Give each tool its own key with the fewest permissions it needs, so you can revoke one without breaking the rest.</li>
              <li>Changes made through a key appear in the <a className="underline" href={`/app/${slug}/settings/audit`}>activity log</a>.</li>
            </ul>
          </Disclosure>
        </div>
      </div>
    </>
  );
}
