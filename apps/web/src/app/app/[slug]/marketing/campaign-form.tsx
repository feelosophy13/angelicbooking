import type { CampaignAudience } from "@angelic/db";
import { Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";

type Action = Parameters<typeof ActionForm>[0]["action"];

export function CampaignForm({ action, slug, campaign, services, staff, locations = [], submitLabel, sms }: { action: Action; slug: string; campaign: { id?: string; name: string; channel: "email" | "sms"; subject: string | null; body: string; audience: CampaignAudience } | null; services: { id: string; name: string }[]; staff: { id: string; displayName: string }[]; locations?: { id: string; name: string }[]; submitLabel: string; sms: boolean }) {
  const a = campaign?.audience ?? {};
  return (
    <ActionForm action={action}>
      <input type="hidden" name="slug" value={slug} />
      {campaign?.id ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Name (internal)" name="name" required><Input name="name" defaultValue={campaign?.name ?? ""} required placeholder="October lash special" /></Field>
        <Field label="Channel" name="channel" hint={sms ? undefined : "Texts need a verified number (Settings → Text messaging)"}>
          <Select name="channel" defaultValue={sms ? (campaign?.channel ?? "email") : "email"}>
            <option value="email">Email</option>
            {sms ? <option value="sms">Text message</option> : null}
          </Select>
        </Field>
      </div>
      <Field label="Subject (email only)" name="subject"><Input name="subject" defaultValue={campaign?.subject ?? ""} placeholder="20% off lash fills this month" /></Field>
      <Field label="Message" name="body" hint="Placeholders: {first_name} {business} {booking_url}. Texts: keep it under 320 characters; the business name and STOP notice are added automatically."><Textarea name="body" rows={6} defaultValue={campaign?.body ?? ""} required placeholder={"Hi {first_name}, …"} /></Field>
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Audience</legend>
        <p className="mb-2 text-xs text-stone-500">Leave everything blank to reach every client who has opted in on that channel.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visited within the last (days)" name="visitedWithinDays"><Input name="visitedWithinDays" type="number" min={1} defaultValue={a.visitedWithinDays ?? ""} placeholder="90" /></Field>
          <Field label="Hasn't visited for at least (days)" name="lapsedDays"><Input name="lapsedDays" type="number" min={1} defaultValue={a.lapsedDays ?? ""} placeholder="60" /></Field>
          <Field label="Has had this service" name="serviceId">
            <Select name="serviceId" defaultValue={a.serviceId ?? ""}><option value="">Any service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
          <Field label="Has seen this provider" name="staffId">
            <Select name="staffId" defaultValue={a.staffId ?? ""}><option value="">Anyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select>
          </Field>
          <Field label="Has this tag" name="tag"><Input name="tag" defaultValue={a.tag ?? ""} placeholder="vip" /></Field>
          {locations.length > 1 ? (
            <Field label="Usually visits" name="locationId" hint="Their most recent visit was at this location.">
              <Select name="locationId" defaultValue={a.locationId ?? ""}><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            </Field>
          ) : null}
          <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" name="neverVisited" defaultChecked={!!a.neverVisited} className="h-4 w-4 accent-brand-600" /> Never completed a visit</label>
        </div>
      </fieldset>
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
