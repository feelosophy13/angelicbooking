import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { BackLink, PageHeader } from "@/components/ui";
import { EmailDesigner } from "@/components/email-designer";
import { starterDesign } from "@/lib/email-design";
import { designerContext } from "@/server/email-designs";
import { saveDesign } from "../actions";

export const metadata: Metadata = { title: "New email design" };

export default async function NewDesignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "marketing.send");
  const c = await designerContext(business);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/marketing/designs`}>Email designs</BackLink></div>
      <PageHeader title="New email design" />
      <EmailDesigner slug={slug} mode="saved" action={saveDesign} hidden={{ slug }} initial={starterDesign()} brand={c.brand} vars={c.vars} scopes={["all", "marketing", "loyalty"]} address={c.address} saveLabel="Save design" />
    </>
  );
}
