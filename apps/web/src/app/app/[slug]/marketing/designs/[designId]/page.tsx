import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { EmailDesigner } from "@/components/email-designer";
import { designerContext, designOf } from "@/server/email-designs";
import { deleteDesign, saveDesign } from "../actions";

export const metadata: Metadata = { title: "Email design" };

export default async function DesignPage({ params }: { params: Promise<{ slug: string; designId: string }> }) {
  const { slug, designId } = await params;
  const { business } = await requireAction(slug, "marketing.send");
  const row = await withTenant(business.id, (tx) => tx.query.emailTemplates.findFirst({ where: and(eq(schema.emailTemplates.id, designId), eq(schema.emailTemplates.kind, "saved")) }));
  if (!row) notFound();
  const [c, used] = await Promise.all([designerContext(business), withTenant(business.id, (tx) => tx.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(eq(schema.campaigns.templateId, row.id), eq(schema.campaigns.status, "draft"))))]);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/marketing/designs`}>Email designs</BackLink></div>
      <PageHeader title={row.name} />
      <EmailDesigner
        key={row.updatedAt.toISOString()}
        slug={slug}
        mode="saved"
        action={saveDesign}
        hidden={{ slug, id: row.id }}
        initial={{ name: row.name, ...designOf(row) }}
        brand={c.brand}
        vars={c.vars}
        scopes={["all", "marketing", "loyalty"]}
        address={c.address}
        saveLabel="Save design"
        aside={
          <form action={deleteDesign} className="px-1">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={row.id} />
            <ConfirmSubmit title="Delete this design?" body={used.length ? `${used.length} draft campaign${used.length === 1 ? " uses" : "s use"} it; they go back to a plain message. Emails already sent are kept.` : "Emails already sent with it are kept."} confirmLabel="Delete" variant="ghost">Delete design</ConfirmSubmit>
          </form>
        }
      />
    </>
  );
}
