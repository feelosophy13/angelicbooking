import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { serviceTree } from "@/server/service-groups";
import { getForm } from "@/server/forms";
import { Button, Card, FormPage } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { FormEditor } from "../form-editor";
import { deleteForm, duplicateFormAction, updateForm } from "../actions";
import QRCode from "qrcode";
import { appUrl } from "@/lib/stripe";

export const metadata: Metadata = { title: "Edit form" };

export default async function EditFormPage({ params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const [form, tree] = await Promise.all([getForm(business.id, formId), serviceTree(business)]);
  if (!form) notFound();
  const recent = await withTenant(business.id, (tx) =>
    tx
      .select({ id: schema.formSubmissions.id, createdAt: schema.formSubmissions.createdAt, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.formSubmissions)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.formSubmissions.clientId))
      .where(eq(schema.formSubmissions.formId, formId))
      .orderBy(desc(schema.formSubmissions.createdAt))
      .limit(10),
  );
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  const shareUrl = appUrl(`/book/${business.slug}/forms/${form.id}`);
  const qr = await QRCode.toDataURL(shareUrl, { margin: 1, width: 160, color: { dark: "#1c1917" } });
  return (
    <FormPage title={form.name} backHref={`/app/${slug}/settings/forms`} backLabel="Forms" width="max-w-3xl">
      {form.active ? (
        <div className="mb-5 flex flex-wrap items-start gap-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
          <img src={qr} alt={`QR code for ${form.name}`} className="h-24 w-24 rounded-lg border border-stone-200 bg-white" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-stone-800">Share this form</h2>
            <p className="mb-2 text-xs text-stone-600">Anyone with the link can fill it in; they enter their name and number or email and it lands on their client record. Put the QR code at the front desk, link it from your website, or text it to a client. Forms assigned to services are also sent automatically with the confirmation.</p>
            <input readOnly value={shareUrl} className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs" />
            <div className="mt-1 flex gap-3 text-xs">
              <a href={shareUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">Open the form →</a>
              <a href={qr} download={`form-${form.id.slice(0, 8)}.png`} className="text-brand-700 underline">Download QR code</a>
            </div>
          </div>
        </div>
      ) : (
        <p className="mb-5 text-xs text-stone-500">This form is inactive: it is not sent with confirmations and its link is off. Tick Active below to share it.</p>
      )}
      <FormEditor action={updateForm} slug={slug} form={form} tree={tree} locations={await listLocations(business.id)} submitLabel="Save form" />
      <div className="mt-6 border-t border-stone-200 pt-4">
        <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-stone-600">Recent submissions</h2><span className="flex gap-3 text-xs"><Link href={`/app/${slug}/settings/forms/submissions?form=${form.id}`} className="text-brand-700 underline">All submissions</Link><Link href={`/app/${slug}/settings/forms/${form.id}/export`} className="text-brand-700 underline">Export CSV</Link></span></div>
        {recent.length === 0 ? <p className="text-sm text-stone-500">Nobody has completed this form yet.</p> : (
          <Card>
            <ul className="divide-y divide-stone-100 text-sm">
              {recent.map((r) => (
                <li key={r.id}><Link href={`/app/${slug}/settings/forms/submissions/${r.id}`} className="flex justify-between px-4 py-2 hover:bg-stone-50"><span>{r.firstName} {r.lastName}</span><span className="text-stone-500">{fmt.format(r.createdAt)}</span></Link></li>
              ))}
            </ul>
          </Card>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={duplicateFormAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="formId" value={form.id} />
            <Button type="submit" size="sm" variant="secondary">Duplicate form</Button>
          </form>
          <form action={deleteForm}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="formId" value={form.id} />
            <ConfirmSubmit title="Delete this form?" body="If anyone has signed it, it is archived instead so their copies are kept." confirmLabel="Delete" variant="ghost">Delete form</ConfirmSubmit>
          </form>
        </div>
      </div>
    </FormPage>
  );
}
