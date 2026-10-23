"use client";
import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui";
import { AiButton } from "@/components/ai-button";
import { DEFAULT_FILL_MESSAGE } from "@/lib/fill-books";
import { draftFillMessageAction } from "../../ai-actions";
import { saveFillSettings } from "./actions";

type Settings = { fillAutoEnabled: boolean; fillAutoHour: number; fillDaysAhead: number; fillMaxPerSlot: number; fillMaxPerDay: number; fillMessage: string | null };

const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;

export function FillSettingsForm({ slug, settings, ai }: { slug: string; settings: Settings; ai: boolean }) {
  const [auto, setAuto] = useState(settings.fillAutoEnabled);
  const [message, setMessage] = useState(settings.fillMessage ?? "");
  return (
    <ActionForm action={saveFillSettings}>
      <input type="hidden" name="slug" value={slug} />
      <Checkbox name="fillAutoEnabled" checked={auto} onChange={(e) => setAuto(e.target.checked)} label="Send invitations automatically every day" hint="Once a day, the best-suited clients are invited to each opening, within the limits below. Texts never go out in quiet hours (before 9 AM or after 8 PM)." />
      {auto ? (
        <Field label="Send from" name="fillAutoHour">
          <Select name="fillAutoHour" defaultValue={String(settings.fillAutoHour)}>
            {Array.from({ length: 11 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="fillAutoHour" value={settings.fillAutoHour} />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Look ahead (days)" name="fillDaysAhead"><Input name="fillDaysAhead" type="number" min={1} max={14} defaultValue={settings.fillDaysAhead} /></Field>
        <Field label="Invitations per opening" name="fillMaxPerSlot" hint="First to book gets it."><Input name="fillMaxPerSlot" type="number" min={1} max={10} defaultValue={settings.fillMaxPerSlot} /></Field>
        <Field label="Invitations per day" name="fillMaxPerDay" hint="By hand and automatic together."><Input name="fillMaxPerDay" type="number" min={1} max={200} defaultValue={settings.fillMaxPerDay} /></Field>
      </div>
      <Field label="Message" name="fillMessage" hint="Placeholders: {first_name} {staff} {when} {service} {link}. Texts start with your business name and end with how to opt out.">
        <div className="space-y-1">
          <Textarea name="fillMessage" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={DEFAULT_FILL_MESSAGE} maxLength={320} />
          {ai ? <AiButton label="Write in our voice" run={() => draftFillMessageAction(slug, message || DEFAULT_FILL_MESSAGE)} onDraft={setMessage} /> : null}
        </div>
      </Field>
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </ActionForm>
  );
}
