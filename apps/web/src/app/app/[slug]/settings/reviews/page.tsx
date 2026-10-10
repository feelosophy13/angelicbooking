import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveReviewSettings } from "./actions";

export const metadata: Metadata = { title: "Review requests" };

export default async function ReviewSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Review requests" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveReviewSettings}>
            <input type="hidden" name="slug" value={slug} />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="reviewRequestEnabled" defaultChecked={business.reviewRequestEnabled} className="h-4 w-4 accent-brand-600" />
              Ask clients for a rating after each completed visit
            </label>
            <Field label="Send after (hours)" name="reviewRequestDelayHours" hint="Counted from when the visit is checked out or marked completed. 0 = right away."><Input name="reviewRequestDelayHours" type="number" min={0} max={168} defaultValue={business.reviewRequestDelayHours} className="w-32" /></Field>
            <Field label="Google review link" name="googleReviewUrl" hint="Clients who give 4 or 5 stars are invited to post on Google too. Get the link from your Google Business Profile → Ask for reviews."><Input name="googleReviewUrl" defaultValue={business.googleReviewUrl ?? ""} placeholder="https://g.page/r/…/review" /></Field>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm text-stone-600">
          <h2 className="mb-1 font-medium text-stone-900">How it works</h2>
          <p>One message per visit, by email when the client has one (otherwise by text), with a one-tap star rating. Ratings and comments land on <Link href={`/app/${slug}/reviews`} className="text-brand-700 underline">Reviews</Link> and on the client&apos;s page. Clients can opt out from the message.</p>
        </Card>
      </div>
    </>
  );
}
