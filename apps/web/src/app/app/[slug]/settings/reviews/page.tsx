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
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">Whether and when the rating request goes out is the <Link href={`/app/${slug}/marketing/automations`} className="text-brand-700 underline">“Ask for a rating” workflow</Link> under Marketing → Automations (turn it on or off, change the delay, add a text or an email around it).</p>
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
