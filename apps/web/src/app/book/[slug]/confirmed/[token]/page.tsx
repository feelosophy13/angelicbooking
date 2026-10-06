import Link from "next/link";
import { notFound } from "next/navigation";
import { getManagedAppointment } from "@/server/public-booking";
import { formatTime } from "@/lib/utils";

export default async function ConfirmedPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const m = await getManagedAppointment(slug, token);
  if (!m || !m.start) notFound();
  const tz = m.business.timezone;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(m.start);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
      <h1 className="text-xl font-semibold">You&apos;re booked{m.client ? `, ${m.client.firstName}` : ""}!</h1>
      <p className="mt-2 text-stone-700">{m.live.map((i) => i.name.replace(" (finish)", "")).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</p>
      <p className="text-stone-700">{day} at {formatTime(m.start, tz)} with {m.live[0]?.staffName}</p>
      <p className="mt-4 text-sm text-stone-500">{m.client?.email || m.client?.phone ? "A confirmation is on its way." : ""} Save this link to manage your appointment:</p>
      <Link href={`/book/${slug}/manage/${token}`} className="mt-2 inline-block text-sm text-brand-700 underline">Manage appointment</Link>
      <div className="mt-6"><Link href={`/book/${slug}`} className="text-sm text-stone-500 underline">Book another appointment</Link></div>
    </div>
  );
}
