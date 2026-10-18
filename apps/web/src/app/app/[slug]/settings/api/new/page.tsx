import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { expandScopes } from "@/lib/api-scopes";
import { FormPage } from "@/components/ui";
import { ApiKeyForm, type KeyDefaults } from "../key-form";

export const metadata: Metadata = { title: "New API key" };

/** Create a key. `?replace=<id>` starts from an existing key, which is revoked when the new one is created. */
export default async function NewApiKeyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ replace?: string }> }) {
  const { slug } = await params;
  const { replace } = await searchParams;
  const { business } = await requireAction(slug, "integrations.manage");
  const replacing = replace
    ? (await withTenant(business.id, (tx) => tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.businessId, business.id)))).find((k) => k.id === replace && !k.revokedAt)
    : undefined;
  const defaults: KeyDefaults | undefined = replacing
    ? { name: replacing.name, scopes: expandScopes(replacing.scopes, replacing.scopeVersion), replaces: { id: replacing.id, name: replacing.name } }
    : undefined;
  return (
    <FormPage title={replacing ? "Replace key" : "New API key"} backHref={`/app/${slug}/settings/api`} backLabel="API access" width="max-w-3xl">
      <ApiKeyForm key={replacing?.id ?? "new"} slug={slug} defaults={defaults} backHref={`/app/${slug}/settings/api`} />
    </FormPage>
  );
}
