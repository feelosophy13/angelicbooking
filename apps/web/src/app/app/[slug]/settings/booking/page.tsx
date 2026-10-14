import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import type { Metadata } from "next";
import Link from "next/link";
import { BackLink, Card, Input, PageHeader, Textarea, Checkbox, Select, MoneyInput } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "Online booking" };
import { saveBookingSettings } from "./actions";
import QRCode from "qrcode";
import { listLocations } from "@/server/locations";
import { lateCancelFeeLabel, policyFeeCheck } from "@angelic/core";
import { formatMoney } from "@/lib/utils";

export default async function BookingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const url = business.customDomain ? `https://${business.customDomain}` : appUrl(`/book/${business.slug}`);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#1c1917" } });
  // One deep link per location: clients land on that site's services and providers.
  const locations = await listLocations(business.id);
  const perLocation = locations.length > 1 ? await Promise.all(locations.map(async (l) => ({ id: l.id, name: l.name, url: `${url}?location=${l.id}`, qr: await QRCode.toDataURL(`${url}?location=${l.id}`, { margin: 1, width: 180, color: { dark: "#1c1917" } }) }))) : [];
  const embed = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;background:${business.brandColor ?? "#6d28d9"};color:#fff;padding:12px 20px;border-radius:8px;font:600 15px system-ui,sans-serif;text-decoration:none">Book now</a>`;
  const latePolicy = { feeType: business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: business.lateCancelFeeValue, deposit: business.lateCancelDeposit as "toward" | "extra" };
  const policyCheck = policyFeeCheck(business.bookingPolicy, latePolicy);
  const feeLabel = lateCancelFeeLabel(latePolicy, (c) => formatMoney(c, business.currency)) ?? "no fee";
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Online booking" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveBookingSettings}>
            <input type="hidden" name="slug" value={slug} />
            <Checkbox name="onlineBookingEnabled" defaultChecked={business.onlineBookingEnabled} label="Allow clients to book online" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Minimum notice" name="minNoticeMin" hint="Minutes before a slot can still be booked."><Input name="minNoticeMin" type="number" min={0} defaultValue={business.minNoticeMin} /></Field>
              <Field label="Book up to" name="maxAdvanceDays" hint="Days ahead."><Input name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={business.maxAdvanceDays} /></Field>
              <Field label="Cancellation window" name="cancelWindowHours" hint="Hours before the visit."><Input name="cancelWindowHours" type="number" min={0} defaultValue={business.cancelWindowHours} /></Field>
            </div>
            <details className="rounded-lg border border-stone-200 p-3" open={business.requireCardOnline || business.noShowFeeCents > 0 || business.lateCancelFeeType !== "none"}>
              <summary className="cursor-pointer select-none text-sm font-medium text-stone-700 marker:content-none [&::-webkit-details-marker]:hidden">
                Fees, deposits and cards <span className="font-normal text-stone-500">· {[
                  business.noShowFeeCents > 0 ? `$${(business.noShowFeeCents / 100).toFixed(0)} no-show` : null,
                  business.lateCancelFeeType === "flat" ? `$${(business.lateCancelFeeValue / 100).toFixed(0)} late cancel` : business.lateCancelFeeType === "percent" ? `${business.lateCancelFeeValue / 100}% late cancel` : null,
                  business.requireCardOnline ? "card required" : null,
                ].filter(Boolean).join(" · ") || "no fees"}</span>
              </summary>
              <div className="mt-3 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="No-show fee" name="noShowFee" hint="Charged to a saved card from the appointment page.">
                    <MoneyInput name="noShowFee" defaultValue={business.noShowFeeCents ? (business.noShowFeeCents / 100).toFixed(2) : ""} />
                  </Field>
                  <Field label="Late cancellation fee" name="lateCancelFeeValue" hint="Inside the cancellation window; shown in the booking policy.">
                    <div className="flex gap-2">
                      <Select name="lateCancelFeeType" defaultValue={business.lateCancelFeeType} className="flex-1">
                        <option value="none">No fee</option>
                        <option value="flat">Flat amount</option>
                        <option value="percent">Percent of services</option>
                      </Select>
                      <Input name="lateCancelFeeValue" inputMode="decimal" defaultValue={business.lateCancelFeeType === "flat" ? (business.lateCancelFeeValue / 100).toFixed(2) : business.lateCancelFeeType === "percent" ? String(business.lateCancelFeeValue / 100) : ""} placeholder="25" className="w-24" aria-label="Fee amount or percent" />
                    </div>
                  </Field>
                  <Field label="A paid deposit, on a late cancellation" name="lateCancelDeposit">
                    <Select name="lateCancelDeposit" defaultValue={business.lateCancelDeposit}>
                      <option value="toward">Counts toward the fee</option>
                      <option value="extra">Is kept on top of the fee</option>
                    </Select>
                  </Field>
                  <Field label="Returned deposits go" name="depositRefundAs" hint="On an in-window cancellation or a staff refund.">
                    <Select name="depositRefundAs" defaultValue={business.depositRefundAs}>
                      <option value="original">Back to the card</option>
                      <option value="store_credit">To the client as store credit</option>
                    </Select>
                  </Field>
                </div>
                <Checkbox name="requireCardOnline" defaultChecked={business.requireCardOnline} label="Require a card on file to book online" hint="Needs Stripe. Nothing is charged at booking; the card is kept for fees." />
                <p className="text-xs text-stone-500">Deposits themselves are set per service.</p>
              </div>
            </details>
            <details className="rounded-lg border border-stone-200 p-3" open={!!business.bookingPolicy || business.clientAccountsEnabled}>
              <summary className="cursor-pointer select-none text-sm font-medium text-stone-700 marker:content-none [&::-webkit-details-marker]:hidden">Policy, address and client accounts</summary>
              <div className="mt-3 space-y-3">
                <Field label="Booking policy" name="bookingPolicy" hint={business.lateCancelFeeType !== "none" ? "Shown to clients when they book. The late cancellation fee above is added for you, so there is no need to repeat it." : "Shown to clients when they book."}><Textarea name="bookingPolicy" rows={5} defaultValue={business.bookingPolicy ?? ""} placeholder="Please arrive 5 minutes early. Late cancellations may be charged." /></Field>
                {policyCheck.conflicts.length ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Your policy says &ldquo;{policyCheck.conflicts[0]}&rdquo; but the late cancellation fee is set to {feeLabel}. Clients see both, and the fee above is the one that is charged. Edit the policy text so they agree.</p>
                ) : null}
                <Field label="Address shown on the booking page and in messages" name="addressLine"><Input name="addressLine" defaultValue={business.addressLine ?? ""} placeholder="123 Main St, Springfield" /></Field>
                <Checkbox name="clientAccountsEnabled" defaultChecked={business.clientAccountsEnabled} label="Client accounts on the booking page" hint="Clients sign in with a code by email or text to see upcoming visits, rebook, and use saved cards and points." />
              </div>
            </details>
            <p className="text-xs text-stone-500">Reminder timing and wording live under <Link href={`/app/${slug}/marketing/automations`} className="text-brand-700 underline">Automations → Appointment reminder</Link>.</p>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Your booking link</h2>
          <input readOnly value={url} className="mb-2 w-full rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs" />
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Open booking page →</a>
          <p className="mt-3 text-xs text-stone-500">Put this link on your website, Instagram bio and Google Business profile.</p>
          <img src={qr} alt="QR code for your booking link" className="mt-3 h-40 w-40 rounded-lg border border-stone-200" />
          <a href={qr} download={`book-${business.slug}.png`} className="mt-1 block text-xs text-brand-700 underline">Download QR code</a>
          {perLocation.length ? (
            <details className="mt-4 border-t border-stone-200 pt-3">
              <summary className="cursor-pointer select-none text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">Per-location links</summary>
              <div className="mt-2 space-y-3">
              <p className="text-xs text-stone-500">Skips the &ldquo;choose a location&rdquo; step. Use the right one on each site&apos;s Google listing, signage and social accounts.</p>
              {perLocation.map((l) => (
                <div key={l.id} className="flex items-start gap-3">
                  <img src={l.qr} alt={`QR code for ${l.name}`} className="h-20 w-20 rounded border border-stone-200" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{l.name}</p>
                    <input readOnly value={l.url} className="mt-1 w-full rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs" />
                    <a href={l.qr} download={`book-${business.slug}-${l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`} className="text-xs text-brand-700 underline">Download QR code</a>
                  </div>
                </div>
              ))}
              </div>
            </details>
          ) : null}
          <details className="mt-4 border-t border-stone-200 pt-3">
            <summary className="cursor-pointer select-none text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden">Where to put the link</summary>
          <div className="mt-2 space-y-2 text-xs text-stone-600">
            <p><b>Instagram:</b> Edit profile → Links → add the link. Business accounts: Edit profile → Action buttons → Book now → “Other” → paste the link.</p>
            <p><b>Facebook page:</b> Add action button → Book now → Link to website → paste the link.</p>
            <p><b>Google Business Profile:</b> Edit profile → Booking → Add appointment link → paste the link. Google shows a Book button on your listing.</p>
            <p><b>Your website:</b> to embed the whole booking flow (or a pop-up button) use <Link href={`/app/${slug}/settings/embed`} className="text-brand-700 underline">Settings → Embed</Link>. For a plain link button, paste this:</p>
            <textarea readOnly rows={3} value={embed} className="w-full rounded border border-stone-300 bg-stone-50 p-2 font-mono text-[11px]" />
            {business.giftCardsOnline ? <p><b>Gift cards:</b> {appUrl(`/book/${business.slug}/gift`)}</p> : null}
          </div>
          </details>
        </Card>
      </div>
    </>
  );
}
