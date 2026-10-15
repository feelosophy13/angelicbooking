import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { SMS_DEFAULTS, SMS_PLACEHOLDERS, SMS_TEMPLATE_KEYS } from "@/lib/notify/sms";
import { saveSmsTemplates } from "./actions";
import Link from "next/link";

export const metadata: Metadata = { title: "Text wording" };

const LABEL: Record<string, string> = { forms_nudge: "Forms still due (morning of the visit)", confirmation: "Confirmation", reminder: "Reminder", rescheduled: "Rescheduled", cancellation: "Cancellation", review_request: "Review request" };

/** The wording of the texts the business sends. The messages themselves (and replies) are on the Messages page. */
export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Text wording">
        <Link href={`/app/${slug}/messages`} className="text-sm text-brand-700 underline">Messages</Link>
      </PageHeader>
      <Card className="max-w-2xl p-4">
        <p className="mb-3 text-xs text-stone-500">Leave a box empty to use the default. Placeholders: {SMS_PLACEHOLDERS.join(" ")}. “Reply STOP to opt out” is added automatically to a client&apos;s first text and to every marketing text.</p>
        <ActionForm action={saveSmsTemplates}>
          <input type="hidden" name="slug" value={slug} />
          {SMS_TEMPLATE_KEYS.map((k) => (
            <Field key={k} label={LABEL[k] ?? k} name={`t_${k}`} hint={`Default: ${SMS_DEFAULTS[k]}`}><Textarea name={`t_${k}`} rows={4} defaultValue={business.smsTemplates?.[k] ?? ""} placeholder={SMS_DEFAULTS[k]} /></Field>
          ))}
          <SubmitButton size="sm" pendingText="Saving…">Save wording</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
