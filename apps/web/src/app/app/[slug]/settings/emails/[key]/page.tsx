import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { EmailDesigner } from "@/components/email-designer";
import { isSystemEmailKey, SYSTEM_EMAILS, systemStarter } from "@/lib/email-design/system";
import { designerContext, designOf, sampleSystemEmail } from "@/server/email-designs";
import { resetSystemDesign, saveSystemDesign } from "../../../marketing/designs/actions";

export const metadata: Metadata = { title: "Email design" };

export default async function SystemEmailDesignPage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key } = await params;
  if (!isSystemEmailKey(key)) notFound();
  const { business } = await requireAction(slug, "settings.business");
  const meta = SYSTEM_EMAILS[key];
  const [c, row] = await Promise.all([designerContext(business), withTenant(business.id, (tx) => tx.query.emailTemplates.findFirst({ where: and(eq(schema.emailTemplates.kind, "system"), eq(schema.emailTemplates.key, key)) }))]);
  const sample = sampleSystemEmail(business, key, c.brandCtx);
  const vars = { ...c.vars, ...Object.fromEntries(Object.entries(sample.vars).map(([k, v]) => [k, String(v ?? "")])) };
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings/emails`}>Email designs</BackLink></div>
      <PageHeader title={meta.label} />
      <p className="-mt-2 mb-4 text-sm text-stone-600">{meta.when} {row ? "Sent in your design." : "Sent in the standard design until you save one here."} The preview uses a sample visit.</p>
      <EmailDesigner
        // A save or a reset starts the editor again from what is now stored.
        key={row ? row.updatedAt.toISOString() : "standard"}
        slug={slug}
        mode="system"
        systemKey={key}
        action={saveSystemDesign}
        hidden={{ slug, key }}
        initial={row ? designOf(row) : systemStarter(key)}
        brand={c.brand}
        vars={vars}
        core={sample.content}
        coreHint={meta.core}
        defaultSubject={sample.subject}
        scopes={meta.scopes}
        address={c.address}
        saveLabel="Save design"
        aside={
          row ? (
            <form action={resetSystemDesign} className="px-1">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="key" value={key} />
              <ConfirmSubmit title="Go back to the standard design?" body="Your design for this email is removed. The standard one goes out from now on." confirmLabel="Reset to standard" variant="ghost">Reset to the standard design</ConfirmSubmit>
            </form>
          ) : null
        }
      />
    </>
  );
}
