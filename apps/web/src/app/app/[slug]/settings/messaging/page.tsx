import Link from "next/link";
import type { Metadata } from "next";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { money } from "@/lib/format";
import { listNumbers, numberMonthlyFeeCents, twilioConfigured, type MessagingNumber } from "@/server/messaging";
import { listLocations } from "@/server/locations";
import { billingState } from "@/server/billing";
import { StatusBadge } from "@/components/status-badge";
import { BackLink, Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/form";
import { refreshVerificationAction, releaseNumberAction } from "./actions";
import { withTenant } from "@angelic/db";

export const metadata: Metadata = { title: "Text messaging" };

const STATUS_HELP: Record<string, string> = {
  unverified: "Carriers require a one-time verification before a toll-free number can send texts. It takes a few minutes to fill in and usually 1 to 3 weeks to approve.",
  pending_review: "Submitted. Carriers are reviewing your details; this usually takes 1 to 3 weeks. We check for updates automatically.",
  in_review: "Under review by the carriers. We check for updates automatically.",
  verified: "Verified. Confirmations and reminders now go out from this number.",
  rejected: "The carriers rejected the verification. Fix the issue below and resubmit.",
};

export default async function MessagingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ bought?: string; submitted?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "settings.business");
  // Reading the number and its status is a business setting; buying, verifying or releasing one is integrations.manage.
  const manage = can(permissions, "integrations.manage");
  const [numbers, locations] = await Promise.all([withTenant(business.id, listNumbers), listLocations(business.id)]);
  const fee = await numberMonthlyFeeCents(business.id);
  const billing = await billingState(business);
  const multi = locations.length > 1;
  const main = numbers.find((n) => !n.locationId) ?? null;
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "Unknown location") : null);
  const submittedFor = sp.submitted ? numbers.find((n) => n.id === sp.submitted) : null;
  const buyHref = (locationId?: string) => `/app/${slug}/settings/messaging/new${locationId ? `?location=${locationId}` : ""}`;
  const canBuy = manage && twilioConfigured() && billing.canBuyNumber;

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Text messaging" />
      {billing.smsPausedReason ? <div className="mb-4"><Notice>{billing.smsPausedReason} Until then no texts are sent to your clients; emails still go out.</Notice></div> : null}
      {sp.bought ? <div className="mb-4"><Notice kind="success">Your number is ready. Next, submit carrier verification so it can send texts.</Notice></div> : null}
      {sp.submitted ? <div className="mb-4"><Notice kind="success">Verification submitted. We will email {submittedFor?.verification?.contactEmail ?? "you"} when the carriers decide.</Notice></div> : null}

      {!main && !numbers.length ? (
        <Card className="max-w-2xl p-5">
          <h2 className="font-medium">Your own toll-free number</h2>
          <p className="mt-1 text-sm text-stone-600">
            Appointment confirmations and reminders are texted to clients from a dedicated toll-free number that belongs to your salon,
            so replies and caller ID are yours. Clients opt in on your booking page.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-600">
            <li>{fee > 0 ? `${money(fee)} per month` : "Included in your plan"}{billing.config.smsUsageCents > 0 ? ` plus ${money(billing.config.smsUsageCents)} per text sent${billing.config.smsIncluded > 0 ? ` after the first ${billing.config.smsIncluded} each month` : ""}` : ""}, on your monthly invoice.</li>
            <li>One-time carrier verification (we prefill it from your profile); approval usually takes 1 to 3 weeks.</li>
            <li>Until the number is verified, text messages are skipped and clients still get email.</li>
            {multi ? <li>One number serves every location. A location that is its own business can get its own number below, so its texts come from it.</li> : null}
          </ul>
          {!twilioConfigured() ? (
            <div className="mt-4"><Notice>Text messaging is not available on this platform yet.</Notice></div>
          ) : !manage ? (
            <div className="mt-4"><Notice>Ask the owner to get a number; that needs the &quot;API keys and text number&quot; permission.</Notice></div>
          ) : !billing.canBuyNumber ? (
            <div className="mt-4"><Notice>Add a card under {can(permissions, "billing.manage") ? <Link href={`/app/${slug}/settings/billing`} className="underline">Billing</Link> : "Billing (ask the owner)"} first; the number is billed monthly.</Notice></div>
          ) : (
            <div className="mt-4"><LinkButton href={buyHref()}>Choose a number</LinkButton></div>
          )}
        </Card>
      ) : (
        <div className="grid max-w-3xl gap-6">
          {numbers.map((number) => (
            <NumberCard key={number.id} number={number} slug={slug} tz={business.timezone} manage={manage} label={number.locationId ? locName(number.locationId)! : multi ? "All locations" : "Your number"} />
          ))}
          {!main && canBuy ? (
            <Card className="p-5 text-sm text-stone-600">
              <p>Locations without their own number have no text sender yet. <Link href={buyHref()} className="text-brand-700 underline">Get a number for the whole business</Link>.</p>
            </Card>
          ) : null}
          <Card className="p-5 text-sm text-stone-600">
            <h3 className="font-medium text-stone-900">How clients opt in</h3>
            <p className="mt-1">
              The booking page has an unticked “Text me confirmations and reminders” box. Only clients who tick it (or whom you mark as opted in on their
              profile) receive texts. Every text names your salon, and clients can reply STOP at any time; Twilio honours that automatically.
            </p>
            <p className="mt-2">
              See every message and its delivery status in <Link href={`/app/${slug}/messages`} className="text-brand-700 underline">Messages</Link>.
            </p>
          </Card>
        </div>
      )}

      {multi ? (
        <Card className="mt-6 max-w-3xl p-5">
          <h2 className="font-medium">Per-location numbers</h2>
          <p className="mt-1 text-sm text-stone-600">Texts about a visit go out from that location&apos;s own number when it has one, else from the business number. Each extra number costs {fee > 0 ? `${money(fee)} per month` : "nothing extra"}.</p>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {locations.map((l) => {
              const own = numbers.find((n) => n.locationId === l.id);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="font-medium">{l.name}</span>
                  {own ? (
                    <span className="text-stone-600">{formatUs(own.phoneNumber)} · <StatusBadge status={own.status} /></span>
                  ) : canBuy ? (
                    <LinkButton href={buyHref(l.id)} size="sm">Get its own number</LinkButton>
                  ) : (
                    <span className="text-xs text-stone-500">uses the business number</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function NumberCard({ number, slug, tz, manage, label }: { number: MessagingNumber; slug: string; tz: string; /** May verify or release it (integrations.manage). */ manage: boolean; label: string }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatUs(number.phoneNumber)}</div>
          <div className="mt-2"><StatusBadge status={number.status} /></div>
        </div>
        <div className="text-right text-sm text-stone-600">
          <div>{number.monthlyFeeCents > 0 ? `${money(number.monthlyFeeCents)} / month` : "Included"}</div>
          <div className="text-xs text-stone-500">since {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz }).format(number.purchasedAt)}</div>
        </div>
      </div>
      <p className="mt-4 text-sm text-stone-600">{STATUS_HELP[number.status]}</p>
      {number.status === "rejected" && number.rejectionReason ? (
        <div className="mt-3"><Notice>
          <span className="font-medium">Carrier feedback:</span> {number.rejectionReason}
          {Array.isArray(number.rejectionDetails) && number.rejectionDetails.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs">{number.rejectionDetails.map((r, i) => <li key={i}>{typeof r === "string" ? r : JSON.stringify(r)}</li>)}</ul>
          ) : null}
        </Notice></div>
      ) : null}
      {manage ? <div className="mt-4 flex flex-wrap items-center gap-2">
        {number.status === "unverified" || number.status === "rejected" ? (
          <LinkButton href={`/app/${slug}/settings/messaging/verify?number=${number.id}`}>{number.status === "rejected" ? "Fix and resubmit" : "Submit verification"}</LinkButton>
        ) : null}
        {number.verificationSid && number.status !== "verified" ? (
          <ActionForm action={refreshVerificationAction} className="inline">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="numberId" value={number.id} />
            <SubmitButton variant="secondary" pendingText="Checking…">Check status</SubmitButton>
          </ActionForm>
        ) : null}
        <ActionForm action={releaseNumberAction} className="inline">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="numberId" value={number.id} />
          <ConfirmSubmit title="Release this number?" body="You lose the number permanently and texts stop until you get a new one and verify it again." confirmLabel="Release" variant="ghost">Release number</ConfirmSubmit>
        </ActionForm>
      </div> : null}
    </Card>
  );
}

function formatUs(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
