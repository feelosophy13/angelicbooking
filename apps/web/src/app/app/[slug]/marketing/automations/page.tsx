import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listAutomations } from "@/server/marketing";
import { Card, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveAutomationAction } from "../actions";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const autos = await listAutomations(business.id);
  return (
    <>
      <p className="mb-4 text-sm text-stone-600">Checked every few minutes and sent between 9am and 8pm in your time zone. Each client gets each message once per occasion. Placeholders: {"{first_name} {business} {booking_url}"}.</p>
      <div className="grid gap-6 lg:grid-cols-3">
        {autos.map((a) => (
          <Card key={a.kind} className="p-4">
            <h2 className="font-medium">{a.title}</h2>
            <p className="mb-3 text-xs text-stone-500">{a.description}</p>
            <ActionForm action={saveAutomationAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="kind" value={a.kind} />
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={a.enabled} className="h-4 w-4 accent-brand-600" /> On</label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Send by" name="channel">
                  <Select name="channel" defaultValue={a.channel}><option value="email">Email</option><option value="sms">Text</option><option value="both">Both</option></Select>
                </Field>
                {a.kind !== "birthday" ? <Field label={a.kind === "win_back" ? "After (days)" : "Days after visit"} name="days"><Input name="days" type="number" min={1} max={730} defaultValue={a.days} /></Field> : <input type="hidden" name="days" value="0" />}
              </div>
              <Field label="Subject (email)" name="subject"><Input name="subject" defaultValue={a.subject ?? ""} /></Field>
              <Field label="Message" name="body"><Textarea name="body" rows={4} defaultValue={a.body} /></Field>
              <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
