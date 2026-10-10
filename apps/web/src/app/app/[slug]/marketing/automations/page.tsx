import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { listAutomations } from "@/server/marketing";
import { Card, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveAutomationAction, saveReminderHours } from "../actions";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "reports.view");
  const autos = await listAutomations(business.id);
  const byKind = Object.fromEntries(autos.map((a) => [a.kind, a]));
  const manage = can(permissions, "business.manage");

  const AutoCard = ({ kind }: { kind: keyof typeof byKind }) => {
    const a = byKind[kind]!;
    return (
      <Card className="p-4">
        <h3 className="font-medium">{a.title}</h3>
        <p className="mb-3 text-xs text-stone-500">{a.description}</p>
        <ActionForm action={saveAutomationAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="kind" value={a.kind} />
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={a.enabled} className="h-4 w-4 accent-brand-600" /> On</label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Send by" name="channel">
              <Select name="channel" defaultValue={a.channel}><option value="email">Email</option><option value="sms">Text</option><option value="both">Both</option></Select>
            </Field>
            {a.kind === "pre_visit" ? <Field label="Hours before" name="hoursBefore"><Input name="hoursBefore" type="number" min={1} max={720} defaultValue={a.hoursBefore} /></Field> : a.kind !== "birthday" ? <Field label={a.kind === "win_back" ? "After (days)" : "Days after visit"} name="days"><Input name="days" type="number" min={1} max={730} defaultValue={a.days} /></Field> : null}
          </div>
          <Field label="Subject (email)" name="subject"><Input name="subject" defaultValue={a.subject ?? ""} /></Field>
          <Field label="Message" name="body"><Textarea name="body" rows={4} defaultValue={a.body} /></Field>
          <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
        </ActionForm>
      </Card>
    );
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Before the visit</h2>
        <p className="mb-3 text-sm text-stone-600">Placeholders for these: {"{first_name} {service} {staff} {when} {manage_url} {forms_url} {business}"}.</p>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-4">
            <h3 className="font-medium">Confirmation</h3>
            <p className="mb-3 text-xs text-stone-500">Always sent when an appointment is booked, by email and text (to clients who opted in), with the manage link, deposit and any forms to complete.</p>
            <p className="text-sm text-stone-600">Edit the text wording under <Link href={`/app/${slug}/settings/notifications`} className="text-brand-700 underline">Settings → Messages</Link>.</p>
          </Card>
          <Card className="p-4">
            <h3 className="font-medium">Reminder</h3>
            <p className="mb-3 text-xs text-stone-500">Always on. Sent before each appointment by email and text; moved automatically when the appointment moves.</p>
            {manage ? (
              <ActionForm action={saveReminderHours}>
                <input type="hidden" name="slug" value={slug} />
                <Field label="Hours before" name="reminderHours"><Input name="reminderHours" type="number" min={1} max={168} defaultValue={business.reminderHours} className="w-32" /></Field>
                <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm">{business.reminderHours} hours before</p>}
          </Card>
          <AutoCard kind="pre_visit" />
        </div>
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">After the visit</h2>
        <p className="mb-3 text-sm text-stone-600">Review requests are under <Link href={`/app/${slug}/settings/reviews`} className="text-brand-700 underline">Settings → Review requests</Link>. Placeholders: {"{first_name} {business} {booking_url}"}.</p>
        <div className="grid gap-6 lg:grid-cols-3"><AutoCard kind="rebook" /></div>
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Keep in touch</h2>
        <p className="mb-3 text-sm text-stone-600">Checked every few minutes and sent between 9am and 8pm in your time zone; each client gets each message once per occasion.</p>
        <div className="grid gap-6 lg:grid-cols-3"><AutoCard kind="birthday" /><AutoCard kind="win_back" /></div>
      </section>
    </div>
  );
}
