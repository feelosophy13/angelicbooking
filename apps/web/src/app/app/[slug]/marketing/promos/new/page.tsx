import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card } from "@/components/ui";
import { PromoForm } from "../promo-form";

export const metadata: Metadata = { title: "New promo code" };

export default async function NewPromoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "marketing.send");
  const services = await withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)));
  return (
    <Card className="max-w-2xl p-5">
      <PromoForm slug={slug} services={services} currency={business.currency} />
    </Card>
  );
}
