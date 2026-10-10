import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { describePromo, listPromoCodes } from "@/server/promos";
import { Button, Card, LinkButton, Empty } from "@/components/ui";
import { togglePromo } from "../actions";

export const metadata: Metadata = { title: "Promo codes" };

export default async function PromosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const rows = await listPromoCodes(business.id);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">Codes clients type when booking online or that staff apply at checkout. Each becomes the ticket&apos;s discount.</p>
        <LinkButton href={`/app/${slug}/marketing/promos/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New code</LinkButton>
      </div>
      {rows.length === 0 ? <Empty title="No promo codes" action={{ href: `/app/${slug}/marketing/promos/new`, label: "Create a code" }} /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`font-mono font-semibold ${p.active ? "" : "text-stone-400 line-through"}`}>{p.code} <span className="font-sans font-normal text-stone-700">· {describePromo(p, business.currency)}</span></p>
                  <p className="text-xs text-stone-500">{[p.expiresAt ? `until ${fmt.format(p.expiresAt)}` : "no expiry", p.maxUses ? `${p.usesCount}/${p.maxUses} used` : `${p.usesCount} used`, p.serviceIds.length ? `${p.serviceIds.length} service${p.serviceIds.length === 1 ? "" : "s"}` : "any service", p.minSubtotalCents ? `min $${(p.minSubtotalCents / 100).toFixed(2)}` : null].filter(Boolean).join(" · ")}</p>
                </div>
                <form action={togglePromo}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={p.active ? "false" : "true"} /><Button size="sm" variant="ghost" type="submit">{p.active ? "Disable" : "Enable"}</Button></form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
