import Link from "next/link";
import { ArrowRight, BadgePercent, CalendarDays, CreditCard, FileSignature, GraduationCap, Megaphone, ShoppingBag, Star, Wallet, Code2, CheckCircle2, MessageSquareText, Upload } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { platformPriceBook } from "@/server/price-book";

const money = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

const FEATURES = [
  { icon: CalendarDays, title: "A calendar that runs the day", body: "Day, week and staff views. Drag to move, click a gap to book, check in on hover. Standing appointments every N weeks, classes with a roster, processing time that frees the chair." },
  { icon: CreditCard, title: "Your own Stripe account", body: "Card payments, deposits and cards on file go straight to your Stripe balance. Refund from the ticket. Tips split by provider for payroll." },
  { icon: MessageSquareText, title: "Texts from your number", body: "Confirmations, reminders and a pre-visit message from your salon's own toll-free number. Replies land on the client's page. Your wording, your tone." },
  { icon: FileSignature, title: "Forms clients sign on their phone", body: "Intake questionnaires and waivers attached to services, linked from the confirmation, kept on the client record with a signature." },
  { icon: Star, title: "Reviews that reach Google", body: "A one-tap rating a couple of hours after checkout. Happy clients are sent on to Google; everything else goes to you first." },
  { icon: BadgePercent, title: "Loyalty, referrals, promo codes", body: "Points on every paid visit, redeemed at checkout. Referral codes with bonuses. Promo codes that work online and at the desk." },
  { icon: Megaphone, title: "Marketing that stays polite", body: "Campaigns to a filtered list, birthday and we-miss-you messages, rebook reminders. Opt-outs respected automatically." },
  { icon: ShoppingBag, title: "Gift cards, store, stock", body: "Sell gift cards and products from your booking page. Track stock, get low-stock warnings, see stock value on the sales report." },
  { icon: Wallet, title: "Payroll in your own format", body: "Commission, hourly and salary rules per provider; product and tip splits; a workbook per person each pay period." },
];

/** Signed-out landing page for the app host. */
export async function Landing() {
  const price = await platformPriceBook();
  const extras = price.perLocationCents > 0 || price.perStaffCents > 0;
  return (
    <div className="min-h-screen bg-white text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" aria-label="Angelic Booking"><Wordmark /></Link>
          <nav className="hidden items-center gap-6 text-sm text-stone-600 md:flex">
            <a href="#features" className="hover:text-stone-900">Features</a>
            <a href="#how" className="hover:text-stone-900">How it works</a>
            <a href="#pricing" className="hover:text-stone-900">Pricing</a>
            <Link href="/help" className="hover:text-stone-900">Help</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LinkButton href="/sign-in" variant="ghost" size="sm">Sign in</LinkButton>
            <LinkButton href="/sign-up" variant="primary" size="sm">Create an account</LinkButton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,#ede9fe_0%,transparent_70%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 md:grid-cols-[1.05fr_1fr] md:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">Built by a salon owner who left Vagaro</p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">The calendar your salon actually runs on.</h1>
            <p className="mt-5 max-w-xl text-lg text-stone-600">Online booking, deposits, texts, forms, reviews, loyalty and payroll in one uncluttered screen. Your clients stay yours and every card payment lands in your own Stripe account.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton href="/sign-up" variant="primary" className="h-11 px-5 text-base">Start free <ArrowRight className="h-4 w-4" /></LinkButton>
              <LinkButton href="/help" className="h-11 px-5 text-base">See how it works</LinkButton>
            </div>
            <ul className="mt-8 grid gap-2 text-sm text-stone-600 sm:grid-cols-2">
              {["Import clients and services from Vagaro", "Booking link, QR code or embed on your site", "Deposits and no-show fees on saved cards", "No marketplace: nobody books your clients away"].map((t) => (
                <li key={t} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {t}</li>
              ))}
            </ul>
          </div>
          <CalendarMock />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-stone-100 bg-stone-50/60">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Everything the front desk does, without the clutter</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-stone-600">One screen for the day, settings out of the way. Every feature below is included.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><f.icon className="h-5 w-5" /></div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Up and running in an afternoon</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            { icon: Upload, n: 1, title: "Bring your data", body: "Export clients, services and upcoming appointments from Vagaro as CSV. Map the columns once, preview, import." },
            { icon: CreditCard, n: 2, title: "Connect Stripe and a text number", body: "Stripe onboarding takes a few minutes and pays you directly. Pick a toll-free number for texts inside the app." },
            { icon: Code2, n: 3, title: "Share the link or embed it", body: "Put your booking link on Instagram and Google, print the QR code, or paste one line to embed booking on your website." },
          ].map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-stone-200 p-6">
              <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white">Step {s.n}</span>
              <s.icon className="mb-3 h-6 w-6 text-brand-700" />
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-stone-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-stone-100 bg-stone-50/60">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-stone-600">{extras ? "Every feature in every plan. You pay for the locations and staff you add, and for what you send." : "No per-seat fees, no feature tiers. Pay for what you send."}</p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-5 md:grid-cols-3">
            <PriceCard label="Platform" value={price.baseCents === 0 ? "Free" : `${money(price.baseCents)}/mo`} note={`${extras ? `Includes ${price.includedLocations} location${price.includedLocations === 1 ? "" : "s"} and ${price.includedStaff} active staff. ${[price.perLocationCents > 0 ? `${money(price.perLocationCents)}/mo per extra location` : "", price.perStaffCents > 0 ? `${money(price.perStaffCents)}/mo per extra staff member` : ""].filter(Boolean).join(", ")}.` : "Every feature, every staff member."}${price.trialDays ? ` ${price.trialDays}-day free trial.` : ""}`} highlight />
            <PriceCard label="Text number" value={`${money(price.numberCents)}/mo`} note="Your own toll-free number for appointment texts. Optional: email is always included." />
            <PriceCard label="Texts" value={`${price.smsUsageCents}¢ each`} note={price.smsIncluded ? `${price.smsIncluded} included each month.` : "Confirmations, reminders, marketing. Only what actually sends."} />
          </div>
          <p className="mt-6 text-center text-sm text-stone-500">Card processing is billed by Stripe at its standard rates, straight from your own account.</p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="rounded-3xl bg-brand-600 px-6 py-12 text-center text-white md:px-12">
          <h2 className="text-3xl font-semibold tracking-tight">Give your front desk a calmer day</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">Create an account, import your Vagaro export, and take your first online booking today.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/sign-up" className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-base font-medium text-brand-700 hover:bg-brand-50">Create an account <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/sign-in" className="inline-flex h-11 items-center rounded-lg border border-white/40 px-5 text-base font-medium text-white hover:bg-white/10">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-stone-500">
          <Wordmark />
          <nav className="flex gap-5">
            <Link href="/help" className="hover:text-stone-900">Help</Link>
            <Link href="/privacy" className="hover:text-stone-900">Privacy</Link>
            <Link href="/terms" className="hover:text-stone-900">Terms</Link>
          </nav>
          <span>© {new Date().getFullYear()} Angelic Booking</span>
        </div>
      </footer>
    </div>
  );
}

function PriceCard({ label, value, note, highlight }: { label: string; value: string; note: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border p-6 ${highlight ? "border-brand-100 bg-white shadow-md ring-1 ring-brand-100" : "border-stone-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-sm text-stone-600">{note}</p>
    </div>
  );
}

/** Illustrative day view: three columns, a few appointments, one class, a now-line. Pure CSS, no data. */
function CalendarMock() {
  const cols = [
    { name: "Maya", color: "#7c3aed", items: [{ t: 0, d: 90, title: "Lash full set", who: "Priya S.", tone: "bg-sky-100 text-sky-900" }, { t: 120, d: 60, title: "Brow lamination", who: "Jordan L.", tone: "bg-emerald-100 text-emerald-900" }, { t: 210, d: 75, title: "Volume fill", who: "Alice N.", tone: "bg-brand-100 text-brand-900" }] },
    { name: "Sam", color: "#0f766e", items: [{ t: 30, d: 120, title: "Full colour", who: "Maria L.", tone: "bg-brand-100 text-brand-900", gap: true }, { t: 180, d: 45, title: "Haircut", who: "Casey T.", tone: "bg-amber-100 text-amber-900" }] },
    { name: "Tiffany", color: "#db2777", items: [{ t: 60, d: 60, title: "Lash lift class", who: "5 of 6 booked", tone: "bg-violet-100 text-violet-900" }, { t: 150, d: 90, title: "Keratin lift", who: "Sarah S.", tone: "bg-sky-100 text-sky-900" }] },
  ];
  const H = 300; // minutes shown
  const px = 1.1;
  return (
    <div className="relative mx-auto w-full max-w-md rounded-2xl border border-stone-200 bg-white p-3 shadow-xl shadow-brand-100/60 md:max-w-none" aria-hidden>
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-stone-500">
        <span className="font-medium text-stone-800">Tuesday, October 14</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">6 booked · $610 expected</span>
      </div>
      <div className="grid grid-cols-[32px_repeat(3,1fr)] gap-1">
        <div />
        {cols.map((c) => (
          <div key={c.name} className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-2 py-1 text-xs font-medium"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</div>
        ))}
        <div className="relative" style={{ height: H * px }}>
          {[0, 60, 120, 180, 240].map((m) => <span key={m} className="absolute right-1 -translate-y-1/2 text-[10px] text-stone-400" style={{ top: m * px }}>{9 + m / 60}{9 + m / 60 >= 12 ? "pm" : "am"}</span>)}
        </div>
        {cols.map((c) => (
          <div key={c.name} className="relative rounded-lg border border-stone-100 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_65px,#f5f5f4_65px,#f5f5f4_66px)]" style={{ height: H * px }}>
            {c.items.map((i) => (
              <div key={i.title} className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-[11px] leading-tight shadow-sm ${i.tone}`} style={{ top: i.t * px, height: i.d * px - 2, borderLeftColor: c.color }}>
                <p className="truncate font-semibold">{i.who}</p>
                <p className="truncate">{i.title}</p>
                {"gap" in i && i.gap ? <div className="absolute inset-x-0 bottom-[38%] h-[28%] bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgba(255,255,255,.6)_5px_10px)]" /> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute left-11 right-3 flex items-center" style={{ top: 58 + 135 * px }}>
        <span className="h-2 w-2 rounded-full bg-red-500" /><span className="h-px flex-1 bg-red-500" />
      </div>
      <div className="absolute -bottom-4 -right-3 hidden rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs shadow-lg md:block">
        <p className="font-medium">New online booking</p>
        <p className="text-stone-500">Priya S. · Lash full set · deposit paid</p>
      </div>
    </div>
  );
}
