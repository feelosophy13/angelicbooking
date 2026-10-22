import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { listSavedDesigns } from "@/server/email-designs";
import { Card, Empty, LinkButton } from "@/components/ui";
import { RowLink, rowClass } from "@/components/row";

export const metadata: Metadata = { title: "Email designs" };

/** Saved email designs: laid out once, picked by campaigns and automation emails. */
export default async function DesignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "marketing.send");
  const rows = await listSavedDesigns(business.id);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">Emails with pictures, buttons and your logo and colors. Campaigns and automation emails pick one as their layout.</p>
        <LinkButton href={`/app/${slug}/marketing/designs/new`} variant="primary" size="sm" className="shrink-0 whitespace-nowrap"><Plus className="h-4 w-4" /> New design</LinkButton>
      </div>
      {rows.length === 0 ? (
        <Empty title="No email designs yet" body="Lay out a newsletter or a special offer once, then send it as a campaign or from an automation." action={{ href: `/app/${slug}/marketing/designs/new`, label: "Design an email" }} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {rows.map((d) => (
              <li key={d.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <div className="min-w-0 flex-1">
                  <RowLink href={`/app/${slug}/marketing/designs/${d.id}`} className="font-medium">{d.name}</RowLink>
                  <p className="truncate text-xs text-stone-500">{d.subject || "No subject yet"} · edited {fmt.format(d.updatedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {can(permissions, "settings.business") ? <p className="mt-4 text-xs text-stone-500">Confirmations, reminders, receipts and other automatic emails have their own designs under <Link href={`/app/${slug}/settings/emails`} className="underline">Settings → Email designs</Link>.</p> : null}
    </>
  );
}
