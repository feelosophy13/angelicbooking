import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";

export default async function BookLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-lg font-semibold">{business.name}</p>
            {business.addressLine ? <p className="text-xs text-stone-500">{business.addressLine}</p> : null}
          </div>
          {business.phone ? <a href={`tel:${business.phone}`} className="text-sm text-brand-700">{business.phone}</a> : null}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 py-8 text-center text-xs text-stone-400">Online booking by Angelic Booking</footer>
    </div>
  );
}
