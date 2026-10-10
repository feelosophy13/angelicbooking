import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { FormEditor } from "../form-editor";
import { createForm } from "../actions";

export const metadata: Metadata = { title: "New form" };

export default async function NewFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const services = await withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)));
  return (
    <FormPage title="New form" backHref={`/app/${slug}/settings/forms`} backLabel="Forms" width="max-w-3xl">
      <FormEditor action={createForm} slug={slug} form={null} services={services} submitLabel="Create form" />
    </FormPage>
  );
}
