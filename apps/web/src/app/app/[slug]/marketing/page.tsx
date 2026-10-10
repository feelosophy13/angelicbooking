import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { listCampaigns } from "@/server/marketing";
import { emailConfigured } from "@/lib/notify/providers";
import { StatusBadge } from "@/components/status-badge";
import { Card, LinkButton, Empty, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const rows = await listCampaigns(business.id);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">One-off emails or texts to a filtered list of clients. Opted-out clients are skipped automatically; every email carries an unsubscribe link and every text says how to stop.</p>
        <LinkButton href={`/app/${slug}/marketing/campaigns/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New campaign</LinkButton>
      </div>
      {!emailConfigured() ? <div className="mb-4"><Notice>Email sending is off on this platform (RESEND_API_KEY). Campaigns are recorded but marked skipped.</Notice></div> : null}
      {rows.length === 0 ? <Empty title="No campaigns yet" body="Announce a new service, fill a quiet week, or win back clients you haven't seen in a while." action={{ href: `/app/${slug}/marketing/campaigns/new`, label: "Create a campaign" }} /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/app/${slug}/marketing/campaigns/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                  <div><p className="font-medium">{c.name}</p><p className="text-xs text-stone-500">{c.channel.toUpperCase()} · {c.status === "sent" ? `sent ${c.sentAt ? fmt.format(c.sentAt) : ""} to ${c.recipientCount}` : `draft · ${fmt.format(c.createdAt)}`}</p></div>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
