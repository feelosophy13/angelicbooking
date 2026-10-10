import Link from "next/link";
import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { money } from "@/lib/format";
import { getActiveNumber, numberMonthlyFeeCents, twilioConfigured } from "@/server/messaging";
import { billingState } from "@/server/billing";
import { StatusBadge } from "@/components/status-badge";
import { BackLink, Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/form";
import { refreshVerificationAction, releaseNumberAction } from "./actions";

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
  const { business } = await requireAction(slug, "business.manage");
  const number = await getActiveNumber(business.id);
  const fee = numberMonthlyFeeCents();
  const billing = billingState(business);

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Text messaging" />
      {sp.bought ? <div className="mb-4"><Notice kind="success">Your number is ready. Next, submit carrier verification so it can send texts.</Notice></div> : null}
      {sp.submitted ? <div className="mb-4"><Notice kind="success">Verification submitted. We will email {number?.verification?.contactEmail ?? "you"} when the carriers decide.</Notice></div> : null}

      {!number ? (
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
          </ul>
          {twilioConfigured() && !billing.canBuyNumber ? (
            <div className="mt-4"><Notice>Add a card under <Link href={`/app/${slug}/settings/billing`} className="underline">Billing</Link> first; the number is billed monthly.</Notice></div>
          ) : twilioConfigured() ? (
            <div className="mt-4"><LinkButton href={`/app/${slug}/settings/messaging/new`}>Choose a number</LinkButton></div>
          ) : (
            <div className="mt-4"><Notice>Text messaging is not available on this platform yet.</Notice></div>
          )}
        </Card>
      ) : (
        <div className="grid max-w-3xl gap-6">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-stone-500">Your number</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{formatUs(number.phoneNumber)}</div>
                <div className="mt-2"><StatusBadge status={number.status} /></div>
              </div>
              <div className="text-right text-sm text-stone-600">
                <div>{number.monthlyFeeCents > 0 ? `${money(number.monthlyFeeCents)} / month` : "Included"}</div>
                <div className="text-xs text-stone-500">since {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone }).format(number.purchasedAt)}</div>
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {number.status === "unverified" || number.status === "rejected" ? (
                <LinkButton href={`/app/${slug}/settings/messaging/verify`}>{number.status === "rejected" ? "Fix and resubmit" : "Submit verification"}</LinkButton>
              ) : null}
              {number.verificationSid ? (
                <ActionForm action={refreshVerificationAction} className="inline">
                  <input type="hidden" name="slug" value={slug} />
                  <SubmitButton variant="secondary" pendingText="Checking…">Check status</SubmitButton>
                </ActionForm>
              ) : null}
              <ActionForm action={releaseNumberAction} className="inline">
                <input type="hidden" name="slug" value={slug} />
                <ConfirmSubmit title="Release this number?" body="You lose the number permanently and texts stop until you get a new one and verify it again." confirmLabel="Release" variant="ghost">Release number</ConfirmSubmit>
              </ActionForm>
            </div>
          </Card>
          <Card className="p-5 text-sm text-stone-600">
            <h3 className="font-medium text-stone-900">How clients opt in</h3>
            <p className="mt-1">
              The booking page has an unticked “Text me confirmations and reminders” box. Only clients who tick it (or whom you mark as opted in on their
              profile) receive texts. Every text names your salon, and clients can reply STOP at any time; Twilio honours that automatically.
            </p>
            <p className="mt-2">
              See every message and its delivery status in <Link href={`/app/${slug}/settings/notifications`} className="text-brand-700 underline">Messages</Link>.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

function formatUs(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
