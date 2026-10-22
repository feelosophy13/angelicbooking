import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { RowLink, rowClass } from "@/components/row";
import { SYSTEM_EMAIL_KEYS, SYSTEM_EMAILS } from "@/lib/email-design/system";
import { listSystemDesigns } from "@/server/email-designs";

export const metadata: Metadata = { title: "Email designs" };

/** The automatic emails, each in the standard design or the business's own. */
export default async function EmailDesignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "settings.business");
  const custom = new Map((await listSystemDesigns(business.id)).map((r) => [r.key, r.updatedAt]));
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Email designs" />
      <p className="mb-4 max-w-2xl text-sm text-stone-600">The emails clients get on their own. Each already carries your logo and color; design one to add a heading, pictures, text and buttons around what it has to say. Text messages are worded under Text wording.</p>
      <Card>
        <ul className="divide-y divide-stone-100 text-sm">
          {SYSTEM_EMAIL_KEYS.map((k) => (
            <li key={k} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
              <div className="min-w-0 flex-1">
                <RowLink href={`/app/${slug}/settings/emails/${k}`} className="font-medium">{SYSTEM_EMAILS[k].label}</RowLink>
                <p className="text-xs text-stone-500">{SYSTEM_EMAILS[k].when}</p>
              </div>
              <span className={custom.has(k) ? "rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700" : "text-xs text-stone-400"}>{custom.has(k) ? "Your design" : "Standard"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
