"use client";
import { useState } from "react";
import Link from "next/link";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import type { CampaignAudience } from "@angelic/db";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { AiButton } from "@/components/ai-button";
import { draftCampaignAction } from "../ai-actions";

type Action = Parameters<typeof ActionForm>[0]["action"];

export function CampaignForm({ action, slug, campaign, services, staff, locations = [], designs = [], submitLabel, sms, ai = false }: { action: Action; slug: string; campaign: { id?: string; name: string; channel: "email" | "sms"; subject: string | null; body: string; templateId?: string | null; audience: CampaignAudience } | null; services: ServiceGroup[]; staff: { id: string; displayName: string }[]; locations?: { id: string; name: string }[]; /** Saved email designs (Marketing → Email designs). */ designs?: { id: string; name: string }[]; submitLabel: string; sms: boolean; /** The AI assistant is on: offer "Draft with AI". */ ai?: boolean }) {
  const a = campaign?.audience ?? {};
  const [channel, setChannel] = useState<"email" | "sms">(sms ? (campaign?.channel ?? "email") : "email");
  const [templateId, setTemplateId] = useState(campaign?.templateId && designs.some((d) => d.id === campaign.templateId) ? campaign.templateId : "");
  const designed = channel === "email" && !!templateId;
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [brief, setBrief] = useState("");
  const filtered = !!(a.visitedWithinDays || a.lapsedDays || a.serviceId || a.staffId || a.tag || a.locationId || a.neverVisited);
  return (
    <ActionForm action={action}>
      <input type="hidden" name="slug" value={slug} />
      {campaign?.id ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Name (internal)" name="name" required><Input name="name" defaultValue={campaign?.name ?? ""} required placeholder="October lash special" /></Field>
        {sms ? (
          <Field label="Channel" name="channel">
            <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value as "email" | "sms")}>
              <option value="email">Email</option>
              <option value="sms">Text message</option>
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="channel" value="email" />
        )}
      </div>
      {!sms ? <p className="-mt-2 text-xs text-stone-500">Sent by email. To send texts, verify a number under <Link href={`/app/${slug}/settings/messaging`} className="underline">Settings → Text messaging</Link>.</p> : null}
      {ai && !designed ? (
        <Disclosure variant="inset" title="Draft with AI" hint="describe the offer; you edit the draft">
          <div className="space-y-2">
            <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. 15% off lash fills booked before Nov 15" aria-label="What the campaign is about" maxLength={500} />
            <AiButton
              label={body.trim() ? "Rewrite the message" : "Draft the message"}
              run={() => draftCampaignAction(slug, { channel, brief, subject, body })}
              onDraft={(d) => { if (d.subject && channel === "email") setSubject(d.subject); setBody(d.body); }}
            />
          </div>
        </Disclosure>
      ) : null}
      {channel === "email" ? <Field label="Subject" name="subject" required><Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required placeholder="20% off lash fills this month" /></Field> : null}
      {channel === "email" && designs.length ? (
        <Field label="Layout" name="templateId" hint={designed ? "The design is the email. Your address and the unsubscribe link are added at the bottom." : undefined}>
          <Select name="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Plain message</option>
            {designs.map((d) => <option key={d.id} value={d.id}>Design: {d.name}</option>)}
          </Select>
        </Field>
      ) : null}
      {designed ? (
        <p className="-mt-2 text-xs text-stone-500"><Link href={`/app/${slug}/marketing/designs/${templateId}`} className="underline">Open the design</Link> to change what it says or send yourself a test.</p>
      ) : (
        <Field label="Message" name="body" hint={channel === "sms" ? "Placeholders: {first_name} {business} {booking_url}. Keep it under 320 characters; the business name and STOP notice are added automatically." : `Placeholders: {first_name} {business} {booking_url}.${designs.length ? "" : " For pictures and buttons, make a design under Email designs."}`}><Textarea name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} required placeholder={"Hi {first_name}, …"} /></Field>
      )}
      <Disclosure title="Audience" hint={filtered ? "filtered" : "every client opted in on this channel"} open={filtered || undefined}>
        <p className="mb-3 text-xs text-stone-500">Leave everything blank to reach every client who has opted in on that channel.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visited within the last (days)" name="visitedWithinDays"><Input name="visitedWithinDays" type="number" min={1} defaultValue={a.visitedWithinDays ?? ""} placeholder="90" /></Field>
          <Field label="Hasn't visited for at least (days)" name="lapsedDays"><Input name="lapsedDays" type="number" min={1} defaultValue={a.lapsedDays ?? ""} placeholder="60" /></Field>
          <Field label="Has had this service" name="serviceId">
            <ServicePicker name="serviceId" groups={services} value={a.serviceId ?? null} placeholder="Any service" noneLabel="Any service" />
          </Field>
          {staff.length > 1 ? (
            <Field label="Has seen this provider" name="staffId">
              <Select name="staffId" defaultValue={a.staffId ?? ""}><option value="">Anyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</Select>
            </Field>
          ) : null}
          <Field label="Has this tag" name="tag"><Input name="tag" defaultValue={a.tag ?? ""} placeholder="vip" /></Field>
          {locations.length > 1 ? (
            <Field label="Usually visits" name="locationId" hint="Their most recent visit was at this location.">
              <Select name="locationId" defaultValue={a.locationId ?? ""}><option value="">Any location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            </Field>
          ) : null}
          <Checkbox name="neverVisited" defaultChecked={!!a.neverVisited} label="Never completed a visit" className="mt-7" />
        </div>
      </Disclosure>
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
