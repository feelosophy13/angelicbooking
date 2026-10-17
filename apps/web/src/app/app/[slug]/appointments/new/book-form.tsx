"use client";
import { useActionState, useState } from "react";
import { book } from "./actions";
import { Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import Link from "next/link";
import { cn } from "@/lib/utils";

const REPEAT: { weeks: number; label: string }[] = [
  { weeks: 0, label: "Does not repeat" },
  { weeks: 1, label: "Every week" },
  ...Array.from({ length: 11 }, (_, i) => ({ weeks: i + 2, label: `Every ${i + 2} weeks` })),
];

type Slot = { iso: string; label: string; staffId?: string; hour: number };
const dayPart = (h: number) => (h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening");

export function BookForm(props: {
  slug: string;
  clientId: string;
  clientName?: string | null;
  serviceId: string;
  extraServiceIds?: string[];
  /** Services joined with " + ", for the summary above the Book button. */
  serviceLabel: string;
  summary?: string;
  staffId: string;
  /** "Any available": times come with their own person, and the desk can also view them stylist by stylist. */
  anyMode?: boolean;
  staffNames: Record<string, string>;
  /** Price and length per person, so the summary is right for whoever the picked time belongs to. */
  totals: Record<string, string>;
  /** How the client will hear about it, or why they won't. */
  confirmation: string;
  perStaff?: { staffId: string; slots: Slot[] }[];
  locationId?: string | null;
  date: string;
  dateLabel: string;
  slots: Slot[];
  preselectIso?: string | null;
  customTimeDefault?: string | null;
  /** The next day with an open time, offered when this one has none. */
  nextOpen?: { label: string; href: string } | null;
  /** There is a client to send a confirmation to. */
  canConfirm?: boolean;
}) {
  const [state, action, pending] = useActionState(book, undefined);
  const [picked, setPicked] = useState<{ iso: string; staffId: string | null } | null>(props.preselectIso ? { iso: props.preselectIso, staffId: props.slots.find((s) => s.iso === props.preselectIso)?.staffId ?? null } : null);
  const [custom, setCustom] = useState<string>(props.preselectIso ? "" : (props.customTimeDefault ?? ""));
  const [customStaff, setCustomStaff] = useState(props.staffId);
  const [repeat, setRepeat] = useState(0);
  const [byStylist, setByStylist] = useState(false);
  const hasCustom = /^\d{2}:\d{2}$/.test(custom);
  const ready = !!picked || hasCustom;
  const pickedLabel = picked ? props.slots.find((s) => s.iso === picked.iso)?.label : null;
  // A listed time carries its own person; an exact time uses whoever the desk chose for it.
  const bookWith = picked ? (picked.staffId ?? props.staffId) : customStaff;
  const timeLabel = pickedLabel ?? custom;
  const withName = props.anyMode ? props.staffNames[bookWith] : null;
  const o = state?.overlap;
  const clashed = !!o && repeat === 0 && o.staffId === bookWith && o.startAt === (picked?.iso ?? "") && o.customTime === (picked ? "" : custom);

  const pick = (iso: string, staffId: string | null) => {
    setPicked({ iso, staffId });
    setCustom("");
  };
  const slotButton = (s: Slot, staffId: string | null, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => pick(s.iso, staffId)}
      title={props.anyMode && s.staffId ? `with ${props.staffNames[s.staffId] ?? ""}` : undefined}
      className={cn("rounded-lg border px-3 py-1.5 text-sm", picked?.iso === s.iso && (picked.staffId ?? null) === staffId ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50")}
    >
      {s.label}
    </button>
  );

  return (
    <Card className="p-4" id="times">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{props.dateLabel}</h2>
        {props.anyMode && props.perStaff ? (
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="How to list open times">
            {([[false, "Any available"], [true, "By stylist"]] as const).map(([v, l]) => (
              <button key={l} type="button" onClick={() => setByStylist(v)} aria-pressed={byStylist === v} className={cn("rounded-md px-3 py-1", byStylist === v ? "bg-stone-900 text-white" : "text-stone-700")}>{l}</button>
            ))}
          </div>
        ) : null}
      </div>
      {props.summary ? <p className="mb-3 text-sm text-stone-600">{props.summary}</p> : null}
      {props.anyMode && byStylist && props.perStaff ? (
        <div className="mb-4 space-y-3">
          {props.perStaff.map((r) => (
            <div key={r.staffId}>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">{props.staffNames[r.staffId]}</p>
              {r.slots.length ? <div className="flex flex-wrap gap-2">{r.slots.map((s) => slotButton(s, r.staffId, `${r.staffId}-${s.iso}`))}</div> : <p className="text-sm text-stone-400">No open times</p>}
            </div>
          ))}
        </div>
      ) : props.slots.length ? (
        <div className="mb-4 space-y-3">
          {(["Morning", "Afternoon", "Evening"] as const).map((part) => {
            const list = props.slots.filter((s) => dayPart(s.hour) === part);
            return list.length ? (
              <div key={part}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">{part}</p>
                <div className="flex flex-wrap gap-2">{list.map((s) => slotButton(s, s.staffId ?? null, s.iso))}</div>
              </div>
            ) : null;
          })}
        </div>
      ) : (
        <p className="mb-4 text-sm text-stone-500">No open slots on this day{props.anyMode ? "" : " for this provider"}.{props.nextOpen ? <> Next opening: <Link href={props.nextOpen.href} className="font-medium text-brand-700 underline">{props.nextOpen.label}</Link>.</> : null} You can still enter a time below (a walk-in that already started, or outside usual hours).</p>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="slug" value={props.slug} />
        <input type="hidden" name="clientId" value={props.clientId} />
        <input type="hidden" name="serviceId" value={props.serviceId} />
        {(props.extraServiceIds ?? []).map((id) => <input key={id} type="hidden" name="extraServiceIds" value={id} />)}
        <input type="hidden" name="staffId" value={bookWith} />
        <input type="hidden" name="date" value={props.date} />
        {props.locationId ? <input type="hidden" name="locationId" value={props.locationId} /> : null}
        <input type="hidden" name="startAt" value={picked?.iso ?? ""} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Or an exact time" hint="Walk-in already in the chair? Enter when it actually started.">
            <Input
              name="customTime"
              type="time"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                if (e.target.value) setPicked(null);
              }}
              className="max-w-[10rem]"
            />
          </Field>
          {props.anyMode && hasCustom ? (
            <Field label="With">
              <Select value={customStaff} onChange={(e) => setCustomStaff(e.target.value)}>
                {Object.entries(props.staffNames).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </Select>
            </Field>
          ) : null}
        </div>
        <details className="rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-medium text-stone-700">More options <span className="font-normal text-stone-500">· notes, repeat</span></summary>
          <div className="mt-3 space-y-3">
            <Field label="Notes (optional)"><Textarea name="notes" rows={3} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeat">
                <Select name="repeatWeeks" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
                  {REPEAT.map((r) => <option key={r.weeks} value={r.weeks}>{r.label}</option>)}
                </Select>
              </Field>
              {repeat > 0 ? <Field label="Number of visits" hint="Including this one; dates that clash are skipped."><Input name="repeatCount" type="number" min={2} max={52} defaultValue={6} /></Field> : null}
            </div>
          </div>
        </details>
        {ready ? (
          <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
            <p className="font-medium text-stone-900">{props.clientName || "Walk-in"} · {props.serviceLabel}</p>
            <p>{props.dateLabel} at {timeLabel}{withName ? ` with ${withName}` : ""}{props.totals[bookWith] ? ` · ${props.totals[bookWith]}` : ""}{repeat > 0 ? ` · repeats ${REPEAT.find((r) => r.weeks === repeat)?.label.toLowerCase()}` : ""}</p>
          </div>
        ) : null}
        {props.canConfirm ? (
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" name="sendConfirmation" defaultChecked className="mt-0.5 h-4 w-4 rounded border-stone-300" />
            <span>Send the client a confirmation<span className="block text-xs text-stone-500">{props.confirmation}</span></span>
          </label>
        ) : <p className="text-xs text-stone-500">{props.confirmation}</p>}
        {state?.error ? <Notice>{state.error}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!ready || pending}>
            {pending ? "Booking…" : ready ? `${repeat > 0 ? "Book series from" : "Book"} ${timeLabel}${withName ? ` with ${withName}` : ""}` : "Pick a time"}
          </Button>
          {/* Offered only for the time and person that just clashed; picking anything else takes it away. */}
          {clashed ? <Button type="submit" name="doubleBook" value="1" variant="secondary" disabled={pending}>Book anyway (double-book)</Button> : null}
        </div>
      </form>
    </Card>
  );
}
