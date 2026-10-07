import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";

export const metadata: Metadata = { title: "Gift cards" };
import { requireBusiness } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { formatMoney } from "@/lib/utils";
import { Card, LinkButton, PageHeader, Empty } from "@/components/ui";

export default async function GiftCardsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const { giftCards } = await getOffersCatalog(business.id);
  const money = (c: number) => formatMoney(c, business.currency);
  return (
    <>
      <PageHeader title="Gift cards">
        {can(permissions, "checkout.take") ? <LinkButton href={`/app/${slug}/gift-cards/new`} variant="primary"><Plus className="h-4 w-4" /> Issue gift card</LinkButton> : null}
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">Cards sold at checkout get their code when the sale is paid. Any card can be redeemed as a payment method at checkout.</p>
      {giftCards.length === 0 ? <Empty title="No gift cards yet" /> : (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Recipient</th><th className="px-4 py-2 text-right">Initial</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2">Issued</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {giftCards.map((g) => (
                <tr key={g.id} className={g.balanceCents === 0 ? "text-stone-400" : ""}>
                  <td className="px-4 py-2 font-mono">{g.code}</td><td className="px-4 py-2">{g.recipientName ?? ""}</td><td className="px-4 py-2 text-right">{money(g.initialCents)}</td><td className="px-4 py-2 text-right font-medium">{money(g.balanceCents)}</td><td className="px-4 py-2 text-stone-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(g.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
