import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, Checkbox, MoneyInput, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { AI_FEATURE_LABELS, aiConfigured, monthUsage } from "@/server/ai";
import { formatMoney } from "@/lib/utils";
import { saveAiSettings } from "./actions";

export const metadata: Metadata = { title: "AI assistant" };

const dollars = (micros: number) => (micros > 0 && micros < 10_000 ? "under $0.01" : formatMoney(Math.round(micros / 10_000), "usd"));

/** The AI assistant's monthly limit, this month's use by feature, and the booking-page chat switch. Not shown when the server has no key. */
export default async function AiSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "settings.business");
  if (!aiConfigured()) notFound();
  const usage = await monthUsage(business.id);
  const spent = usage.reduce((s, u) => s + u.micros, 0);
  const limitMicros = business.aiMonthlyBudgetCents * 10_000;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="AI assistant" />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <ActionForm action={saveAiSettings}>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Monthly limit" name="budget" hint="When this month's use reaches it, the AI buttons say so until the 1st. Set 0 to turn the assistant off."><MoneyInput name="budget" currency={business.currency} defaultValue={(business.aiMonthlyBudgetCents / 100).toFixed(2)} /></Field>
            <Checkbox name="aiChatbotEnabled" defaultChecked={business.aiChatbotEnabled} label="Answer questions on the booking page" hint="A chat button on your booking page answers from your services, prices, hours and policy, and links to booking. It can't book, change or cancel anything, and never asks for personal details." />
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="mb-1 font-medium text-stone-900">This month</h2>
          <p className="text-stone-600">{dollars(spent)} of {formatMoney(business.aiMonthlyBudgetCents, "usd")} used{limitMicros && spent >= limitMicros ? " (limit reached)" : ""}.</p>
          {usage.length ? (
            <ul className="mt-3 divide-y divide-stone-100">
              {usage.map((u) => (
                <li key={u.feature} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-stone-700">{AI_FEATURE_LABELS[u.feature] ?? u.feature}<span className="block text-xs text-stone-500">{u.requests} request{u.requests === 1 ? "" : "s"}</span></span>
                  <span className="tabular-nums text-stone-700">{dollars(u.micros)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs text-stone-500">Nothing yet. Look for the ✦ buttons on a service, a campaign, the Inbox and Fill open slots.</p>}
          <p className="mt-3 text-xs text-stone-500">Drafts are written by Claude (Anthropic). It gets your services, hours, policy and the words you are working on; for an Inbox suggestion, the client&apos;s first name and the recent texts with phone numbers and emails removed. Nothing is sent without someone pressing Send.</p>
        </Card>
      </div>
    </>
  );
}
