import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getManagedAppointment } from "@/server/public-booking";
import { formatMoney, formatTime } from "@/lib/utils";
import { addressOf } from "@/server/locations";
import { CalendarPlus, MapPin, Phone } from "lucide-react";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConfirmedPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  // Inside an embed, links leave the iframe so the client lands on the full page.
  const embed = ((await headers()).get("x-pathname") ?? "").startsWith("/embed/");
  const top = embed ? { target: "_top" as const } : {};
  const m = await getManagedAppointment(slug, token);
  if (!m || !m.start) notFound();
  const tz = m.timeZone;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(m.start);
  const end = m.live.reduce<Date>((e, i) => (i.endAt > e ? i.endAt : e), m.start);
  const total = m.live.reduce((s, i) => s + i.priceCents, 0);
  const paid = m.appt.depositStatus === "paid" && m.appt.depositCents > 0;
  const address = addressOf(m.location) ?? m.business.addressLine ?? null;
  const phone = m.location?.phone ?? m.business.phone ?? null;
  const g = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${m.live[0]?.name.replace(" (finish)", "") ?? "Appointment"} at ${m.business.name}`)}&dates=${g(m.start)}/${g(end)}&details=${encodeURIComponent(`Manage: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/book/${slug}/manage/${token}`)}&location=${encodeURIComponent((m.location ? addressOf(m.location) : null) ?? m.business.addressLine ?? m.business.name)}`;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
      <h1 className="text-xl font-semibold">You&apos;re booked{m.client ? `, ${m.client.firstName}` : ""}!</h1>
      <p className="mt-2 text-stone-700">{m.live.map((i) => i.name.replace(" (finish)", "")).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</p>
      <p className="text-stone-700">{day} at {formatTime(m.start, tz)} with {m.live[0]?.staffName}</p>
      <dl className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm">
        <div className="flex justify-between gap-4"><dt className="text-stone-500">Total</dt><dd className="font-medium text-stone-800">{formatMoney(total, m.business.currency)}</dd></div>
        {paid ? <div className="flex justify-between gap-4"><dt className="text-stone-500">Deposit paid</dt><dd className="font-medium text-stone-800">{formatMoney(m.appt.depositCents, m.business.currency)}</dd></div> : null}
        {paid ? <div className="flex justify-between gap-4"><dt className="text-stone-500">Due at the salon</dt><dd className="font-medium text-stone-800">{formatMoney(Math.max(0, total - m.appt.depositCents), m.business.currency)}</dd></div> : null}
      </dl>
      <div className="mx-auto mt-3 max-w-xs space-y-1 text-left text-sm text-stone-600">
        {address ? <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden /><span>{m.location?.name ? `${m.location.name}, ` : ""}{address}</span></p> : null}
        {phone ? <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /><a href={`tel:${phone}`} className="underline">{phone}</a></p> : null}
      </div>
      {m.business.bookingPolicy ? <p className="mx-auto mt-3 max-w-xs text-xs text-stone-500">{m.business.bookingPolicy}</p> : null}
      <p className="mt-4 text-sm text-stone-500">{m.client?.email ? `A confirmation is on its way to ${maskEmail(m.client.email)}.` : m.client?.phone ? "A confirmation text is on its way." : "Keep this page: it is your confirmation."} You can change or cancel from the link below.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
        <a href={gcalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50"><CalendarPlus className="h-4 w-4" /> Google Calendar</a>
        <a href={`/book/${slug}/manage/${token}/calendar.ics`} {...top} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50"><CalendarPlus className="h-4 w-4" /> Apple / Outlook (.ics)</a>
      </div>
      <Link href={`/book/${slug}/manage/${token}`} {...top} className="mt-3 inline-block text-sm underline" style={{ color: "var(--brand)" }}>Manage appointment</Link>
      <div className="mt-6"><Link href={embed ? `/embed/${slug}` : `/book/${slug}`} className="text-sm text-stone-500 underline">Book another appointment</Link></div>
    </div>
  );
}

/** "jane.doe@gmail.com" → "j•••@gmail.com": enough to recognise, not enough to learn someone's address from a booking. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user!.slice(0, 1)}•••@${domain}` : "your email";
}
