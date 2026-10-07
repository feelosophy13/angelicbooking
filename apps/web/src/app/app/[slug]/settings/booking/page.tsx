import { requireAction } from "@/lib/tenant";
import { appUrl } from "@/lib/stripe";
import type { Metadata } from "next";
import { BackLink, Card, Input, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

export const metadata: Metadata = { title: "Online booking" };
import { saveBookingSettings } from "./actions";

export default async function BookingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const url = appUrl(`/book/${business.slug}`);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Online booking" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveBookingSettings}>
            <input type="hidden" name="slug" value={slug} />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="onlineBookingEnabled" defaultChecked={business.onlineBookingEnabled} className="h-4 w-4 accent-brand-600" />
              Allow clients to book online
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Minimum notice (minutes)" name="minNoticeMin" hint="Earliest a client can book from now."><Input name="minNoticeMin" type="number" min={0} defaultValue={business.minNoticeMin} /></Field>
              <Field label="Book up to (days ahead)" name="maxAdvanceDays"><Input name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={business.maxAdvanceDays} /></Field>
              <Field label="Cancellation window (hours)" name="cancelWindowHours" hint="Clients can cancel/reschedule online until this many hours before."><Input name="cancelWindowHours" type="number" min={0} defaultValue={business.cancelWindowHours} /></Field>
              <Field label="Reminder (hours before)" name="reminderHours"><Input name="reminderHours" type="number" min={1} max={168} defaultValue={business.reminderHours} /></Field>
              <Field label="No-show fee" name="noShowFee" hint="Charged to a saved card from the appointment page."><Input name="noShowFee" inputMode="decimal" defaultValue={business.noShowFeeCents ? (business.noShowFeeCents / 100).toFixed(2) : ""} placeholder="0" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="requireCardOnline" defaultChecked={business.requireCardOnline} className="h-4 w-4 accent-brand-600" />
              Require a card on file to book online <span className="text-xs text-stone-500">(needs Stripe; enforced in a later release)</span>
            </label>
            <Field label="Address (shown on booking page and messages)" name="addressLine"><Input name="addressLine" defaultValue={business.addressLine ?? ""} placeholder="123 Main St, Springfield" /></Field>
            <Field label="Booking policy" name="bookingPolicy" hint="Shown to clients when they book."><Textarea name="bookingPolicy" rows={3} defaultValue={business.bookingPolicy ?? ""} placeholder="Please arrive 5 minutes early. Late cancellations may be charged." /></Field>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Your booking link</h2>
          <input readOnly value={url} className="mb-2 w-full rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs" />
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Open booking page →</a>
          <p className="mt-3 text-xs text-stone-500">Put this link on your website, Instagram bio and Google Business profile.</p>
        </Card>
      </div>
    </>
  );
}
