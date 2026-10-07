import { requireAction } from "@/lib/tenant";
import type { Metadata } from "next";
import { FormPage, Input } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "Custom domain" };
import { saveCustomDomain } from "../locations/actions";

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const host = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "");
  return (
    <FormPage title="Custom booking domain" backHref={`/app/${slug}/settings`} backLabel="Settings" width="max-w-xl">
      <p className="mb-3 text-sm text-stone-600">Serve your booking page from your own hostname instead of {host}/book/{business.slug}.</p>
      <ActionForm action={saveCustomDomain}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Hostname" name="customDomain"><Input name="customDomain" defaultValue={business.customDomain ?? ""} placeholder="book.yoursalon.com" /></Field>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </ActionForm>
      <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-stone-600">
        <li>Add a CNAME record for that hostname pointing at <code>{host || "your app host"}</code>.</li>
        <li>Add the hostname to your hosting provider so it issues an SSL certificate (Vercel: Project → Domains; DigitalOcean: App → Domains).</li>
        <li>Visitors to that hostname land directly on your booking page.</li>
      </ol>
    </FormPage>
  );
}
