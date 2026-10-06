import { redirect } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { syncConnectAccount } from "@/server/stripe-connect";

// Stripe sends the business back here after onboarding. Pull the latest status.
export default async function ConnectReturnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  if (business.stripeAccountId) await syncConnectAccount(business.id, business.stripeAccountId);
  redirect(`/app/${slug}/settings/payments`);
}
