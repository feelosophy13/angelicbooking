import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";
import { applyUnsubscribe } from "@/server/marketing";

export default async function UnsubscribePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  const ok = await applyUnsubscribe(business, token);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">
      {ok ? <>You&apos;re unsubscribed from emails from {business.name}. Appointment confirmations and receipts for bookings you make are still sent.</> : <>That link isn&apos;t valid. Contact {business.name} to update your preferences.</>}
    </div>
  );
}
