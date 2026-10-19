import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { smsAvailableFor } from "@/server/messaging";
import { campaignStats, previewCampaign } from "@/server/marketing";
import { Card } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { serviceGroups } from "@/server/service-groups";
import { CampaignForm } from "../../campaign-form";
import { deleteCampaign, sendCampaignAction, updateCampaign } from "../../actions";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ slug: string; campaignId: string }> }) {
  const { slug, campaignId } = await params;
  const { business } = await requireAction(slug, "marketing.send");
  const p = await previewCampaign(business, campaignId);
  if (!p) notFound();
  const { campaign } = p;
  const sms = await smsAvailableFor(business.id);
  const [services, staff, locations] = await withTenant(business.id, async (tx) => [
    await serviceGroups(business, { meta: "none" }),
    await tx.select({ id: schema.staff.id, displayName: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)),
    await tx.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations).orderBy(asc(schema.locations.name)),
  ]);
  const stats = campaign.status === "sent" ? await campaignStats(business.id, campaign.id) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        {campaign.status === "sent" ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{campaign.name}</p>
            <p className="text-stone-600">{campaign.channel.toUpperCase()} · sent to {campaign.recipientCount} client{campaign.recipientCount === 1 ? "" : "s"}</p>
            {campaign.subject ? <p><b>Subject:</b> {campaign.subject}</p> : null}
            <p className="whitespace-pre-line rounded-lg bg-stone-50 p-3">{campaign.body}</p>
          </div>
        ) : (
          <CampaignForm action={updateCampaign} slug={slug} campaign={campaign} services={services} staff={staff} locations={locations} submitLabel="Save" sms={sms} />
        )}
      </Card>
      <div className="space-y-4">
        <Card className="p-4 text-sm">
          <h2 className="mb-1 font-medium">{campaign.status === "sent" ? "Delivery" : "Audience right now"}</h2>
          {stats ? (
            <p>{stats.sent} sent · {stats.pending} pending · {stats.failed} failed or skipped</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">{p.count} <span className="text-sm font-normal text-stone-500">client{p.count === 1 ? "" : "s"} reachable by {campaign.channel}</span></p>
              {p.sample.length ? <p className="mt-1 text-xs text-stone-500">e.g. {p.sample.map((c) => `${c.firstName} ${c.lastName}`.trim()).join(", ")}{p.count > p.sample.length ? "…" : ""}</p> : null}
              {p.count > 0 ? (
                <form action={sendCampaignAction} className="mt-3">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <ConfirmSubmit title={`Send to ${p.count} client${p.count === 1 ? "" : "s"}?`} body="Save your edits first. This can't be undone." confirmLabel="Send now" variant="primary" className="w-full">Send campaign</ConfirmSubmit>
                </form>
              ) : <p className="mt-3 text-xs text-stone-500">Nobody matches this audience on {campaign.channel === "sms" ? "text" : "email"} yet. Widen the audience and save to send.</p>}
            </>
          )}
        </Card>
        <form action={deleteCampaign}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="campaignId" value={campaign.id} />
          <ConfirmSubmit title="Delete this campaign?" body="Messages already sent are kept in the log." confirmLabel="Delete" variant="ghost">Delete campaign</ConfirmSubmit>
        </form>
      </div>
    </div>
  );
}
