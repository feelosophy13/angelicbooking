import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, CreditCard, LogOut } from "lucide-react";
import { getPublicBusiness } from "@/server/public-booking";
import { clientAccountData, currentClient } from "@/server/client-auth";
import { formatMoney, formatTime } from "@/lib/utils";
import { ProfileForm, SignInForm } from "./forms";
import { removeCard, signOutClient } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ card?: string }> }) {
  const { slug } = await params;
  const cardInUse = (await searchParams).card === "in-use";
  const business = await getPublicBusiness(slug);
  if (!business || !business.clientAccountsEnabled) notFound();
  const me = await currentClient(business);
  if (!me) {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-stone-200 bg-white p-5">
        <h1 className="mb-1 text-xl font-semibold">Your account</h1>
        <p className="mb-4 text-sm text-stone-600">See your upcoming visits, rebook in one tap and manage your details.</p>
        <SignInForm slug={slug} />
      </div>
    );
  }
  const data = await clientAccountData(business, me.id);
  if (!data) notFound();
  const tz = business.timezone;
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(d);
  const rebook = (v: { serviceId: string | null; staffId: string; classSessionId: string | null }) => (v.serviceId ? `/book/${slug}?service=${v.serviceId}${v.classSessionId ? "" : `&staff=${v.staffId}`}` : `/book/${slug}`);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Hi {data.client.firstName}</h1>
        <form action={signOutClient}><input type="hidden" name="slug" value={slug} /><button className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"><LogOut className="h-4 w-4" /> Sign out</button></form>
      </div>
      <Link href={`/book/${slug}`} className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white" style={{ background: "var(--brand)" }}><CalendarPlus className="h-4 w-4" /> Book an appointment</Link>

      <section className="rounded-xl border border-stone-200 bg-white">
        <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming</h2>
        {data.upcoming.length === 0 ? <p className="px-4 py-3 text-sm text-stone-500">Nothing booked yet.</p> : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.upcoming.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div><p className="font-medium">{v.serviceName.replace(" (finish)", "")}</p><p className="text-xs text-stone-500">{day(v.startAt)} · {formatTime(v.startAt, tz)} · with {v.staffName}</p></div>
                <Link href={`/book/${slug}/manage/${v.manageToken}`} className="text-xs underline" style={{ color: "var(--brand)" }}>Manage</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.past.length ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Past visits</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {data.past.slice(0, 10).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className={v.status === "cancelled" || v.status === "no_show" ? "text-stone-400" : ""}><p>{v.serviceName.replace(" (finish)", "")} <span className="text-xs text-stone-500">with {v.staffName}</span></p><p className="text-xs text-stone-500">{day(v.startAt)}{v.status === "cancelled" ? " · cancelled" : ""}</p></div>
                {v.serviceId && v.status !== "cancelled" ? <Link href={rebook(v)} className="rounded-lg border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Rebook</Link> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(data.points > 0 || data.referralCode || data.packs.length || data.memberships.length || data.giftCards.length) ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-stone-600">Rewards &amp; credits</h2>
          {business.loyaltyEnabled && data.points > 0 ? <p><b>{data.points.toLocaleString()}</b> points · worth {formatMoney(data.points * business.loyaltyPointValueCents, business.currency)} at checkout{data.points < business.loyaltyMinRedeemPoints ? ` (redeem from ${business.loyaltyMinRedeemPoints})` : ""}</p> : null}
          {data.referralCode ? <p className="mt-1">Your referral code: <span className="font-mono font-semibold">{data.referralCode}</span>{business.referralBonusPoints ? ` · earn ${business.referralBonusPoints} points when a friend books with it` : ""}</p> : null}
          {data.packs.map((p) => <p key={p.id} className="mt-1">{p.name}: {p.remaining} session{p.remaining === 1 ? "" : "s"} left</p>)}
          {data.memberships.map((m) => <p key={m.id} className="mt-1">{m.name}: {m.frozenUntil ? `frozen until ${day(m.frozenUntil)}` : m.status === "paused" ? "paused" : `${m.creditsRemaining} credit${m.creditsRemaining === 1 ? "" : "s"} · ${m.cycleCount && m.cyclesBilled >= m.cycleCount ? "ends" : m.autoRenew ? "renews" : "period ends"} ${day(m.currentPeriodEnd)}`}</p>)}
          {data.giftCards.map((g) => <p key={g.code} className="mt-1">Gift card {g.code}: {formatMoney(g.balanceCents, business.currency)} left</p>)}
        </section>
      ) : null}

      {data.cards.length ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-stone-600">Saved cards</h2>
          {cardInUse ? <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">That card is holding an upcoming booking or paying a membership, so it can&apos;t be removed here. Call us to change it.</p> : null}
          <ul className="space-y-1">
            {data.cards.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-stone-400" /> {c.brand.toUpperCase()} •••• {c.last4} <span className="text-xs text-stone-500">{c.expMonth}/{String(c.expYear).slice(2)}{new Set(data.cards.map((x) => x.accountId)).size > 1 && c.siteName ? ` · ${c.siteName}` : ""}</span></span>
                <form action={removeCard}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="paymentMethodId" value={c.id} /><button className="text-xs text-stone-500 underline hover:text-red-600">Remove</button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-600">Your details</h2>
        <ProfileForm slug={slug} client={data.client} />
      </section>
    </div>
  );
}
