import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { saveCustomDomain } from "../locations/actions";

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const host = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "");
  return (
    <FormPage title="Custom booking domain" backHref={`/app/${slug}/settings`} backLabel="Settings" width="max-w-xl">
      <p className="mb-3 text-sm text-stone-600">Serve your booking page from your own hostname instead of {host}/book/{business.slug}.</p>
      <form action={saveCustomDomain} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Hostname"><Input name="customDomain" defaultValue={business.customDomain ?? ""} placeholder="book.yoursalon.com" /></Field>
        <Button type="submit">Save</Button>
      </form>
      <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-stone-600">
        <li>Add a CNAME record for that hostname pointing at <code>{host || "your app host"}</code>.</li>
        <li>Add the hostname to your hosting provider so it issues an SSL certificate (Vercel: Project → Domains; DigitalOcean: App → Domains).</li>
        <li>Visitors to that hostname land directly on your booking page.</li>
      </ol>
    </FormPage>
  );
}
