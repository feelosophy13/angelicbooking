import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { getForm } from "@/server/forms";
import { Card, FormPage } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { FormEditor } from "../form-editor";
import { deleteForm, updateForm } from "../actions";

export const metadata: Metadata = { title: "Edit form" };

export default async function EditFormPage({ params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const [form, services] = await Promise.all([
    getForm(business.id, formId),
    withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name))),
  ]);
  if (!form) notFound();
  const recent = await withTenant(business.id, (tx) =>
    tx
      .select({ id: schema.formSubmissions.id, createdAt: schema.formSubmissions.createdAt, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.formSubmissions)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId))
      .where(eq(schema.formSubmissions.formId, formId))
      .orderBy(desc(schema.formSubmissions.createdAt))
      .limit(20),
  );
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <FormPage title={form.name} backHref={`/app/${slug}/settings/forms`} backLabel="Forms" width="max-w-3xl">
      <FormEditor action={updateForm} slug={slug} form={form} services={services} submitLabel="Save form" />
      <div className="mt-6 border-t border-stone-200 pt-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-600">Recent submissions</h2>
        {recent.length === 0 ? <p className="text-sm text-stone-500">Nobody has completed this form yet.</p> : (
          <Card>
            <ul className="divide-y divide-stone-100 text-sm">
              {recent.map((r) => (
                <li key={r.id}><Link href={`/app/${slug}/settings/forms/submissions/${r.id}`} className="flex justify-between px-4 py-2 hover:bg-stone-50"><span>{r.firstName} {r.lastName}</span><span className="text-stone-500">{fmt.format(r.createdAt)}</span></Link></li>
              ))}
            </ul>
          </Card>
        )}
        <form action={deleteForm} className="mt-4">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="formId" value={form.id} />
          <ConfirmSubmit title="Delete this form?" body="If anyone has signed it, it is archived instead so their copies are kept." confirmLabel="Delete" variant="ghost">Delete form</ConfirmSubmit>
        </form>
      </div>
    </FormPage>
  );
}
