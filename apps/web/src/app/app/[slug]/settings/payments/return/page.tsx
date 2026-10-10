import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { syncConnectAccount } from "@/server/stripe-connect";

// Stripe sends the business back here after onboarding (the main account, or a location's own). Pull the latest status.
export default async function ConnectReturnPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ location?: string }> }) {
  const { slug } = await params;
  const { location } = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  const accountId = location
    ? (await withTenant(business.id, (tx) => tx.query.locations.findFirst({ where: eq(schema.locations.id, location), columns: { stripeAccountId: true } })))?.stripeAccountId
    : business.stripeAccountId;
  if (accountId) await syncConnectAccount(business.id, accountId);
  redirect(`/app/${slug}/settings/payments`);
}
