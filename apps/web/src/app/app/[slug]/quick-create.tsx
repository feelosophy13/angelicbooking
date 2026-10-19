"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import { Button, Checkbox, Input, Label, Notice, Select } from "@/components/ui";
import { ClientPicker } from "@/components/client-picker";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { quickCreateClient } from "./clients/actions";
import { quickBlock, quickBook } from "./actions";
import type { AnchorRect } from "./calendar-tooltip";

/** Everything the popover needs that the page knows: the menu, who can be booked for what, and what this person may do. */
export type QuickCreateData = {
  slug: string;
  serviceGroups: ServiceGroup[];
  /** Length (hands-on + waiting + finish) and price per service, for the "ends at" line. */
  services: Record<string, { name: string; lengthMin: number }>;
  staff: { id: string; name: string }[];
  /** Service id → the staff assigned to it; a service with no entry can be done by anyone. */
  staffFor: Record<string, string[]>;
  canBook: boolean;
  canBlock: boolean;
  canCreateClient: boolean;
  locationId: string | null;
  /** The full New appointment page, without query (the popover adds what was chosen). */
  newHref: string;
  blockHref: string;
};

/** Where the person clicked or drew on the grid. */
export type QuickCreateAt = { date: string; dateLabel: string; startMin: number; /** Set when a range was drawn (block end); otherwise the service decides. */ endMin: number | null; staffId: string | null; anchor: AnchorRect };

const WIDTH = 352;
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/**
 * Google Calendar's quick create, for a salon: click (or draw) on an empty slot and book a service there without leaving the calendar.
 * One client, one service, one provider, one time; "More options" opens the full New appointment page with the same choices for
 * add-on services, repeats and notes. A second tab blocks the drawn range instead (lunch, a meeting) for those allowed to.
 */
export function QuickCreate({ data, at, fmt, onClose, onBooked }: { data: QuickCreateData; at: QuickCreateAt; fmt: (min: number) => string; onClose: () => void; onBooked: (r: { kind: "appointment" | "block"; appointmentId: string; message: string }) => void }) {
  const [tab, setTab] = useState<"appointment" | "block">(data.canBook ? "appointment" : "block");
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Beside what was drawn: to its right if there is room, else to its left; level with its top, kept on screen.
    let left = at.anchor.right + 8;
    if (left + WIDTH > vw - 8) left = Math.max(8, at.anchor.left - WIDTH - 8);
    if (left + WIDTH > vw - 8) left = Math.max(8, vw - WIDTH - 8);
    const top = Math.min(Math.max(8, at.anchor.top), Math.max(8, vh - el.offsetHeight - 8));
    setPos({ left, top });
  }, [at, tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    // Clicking anywhere outside (another slot, the page) closes it; pickers open their lists inside the popover, so they stay.
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={tab === "appointment" ? "New appointment" : "Block time"}
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? 0, width: `min(${WIDTH}px, calc(100vw - 16px))`, opacity: pos ? 1 : 0 }}
      className="z-50 rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-800 shadow-2xl"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {data.canBook && data.canBlock ? (
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="tablist">
            {(["appointment", "block"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1", tab === t ? "bg-stone-900 text-white" : "text-stone-700")}>{t === "appointment" ? "Appointment" : "Block time"}</button>
            ))}
          </div>
        ) : (
          <h2 className="font-semibold text-stone-900">{tab === "appointment" ? "New appointment" : "Block time"}</h2>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"><X className="h-4 w-4" /></button>
      </div>
      {tab === "appointment" ? <AppointmentTab data={data} at={at} fmt={fmt} onBooked={onBooked} /> : <BlockTab data={data} at={at} fmt={fmt} onBooked={onBooked} />}
    </div>,
    document.body,
  );
}

function AppointmentTab({ data, at, fmt, onBooked }: { data: QuickCreateData; at: QuickCreateAt; fmt: (min: number) => string; onBooked: (r: { kind: "appointment"; appointmentId: string; message: string }) => void }) {
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  const [time, setTime] = useState(hhmm(at.startMin));
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);
  const [pending, start] = useTransition();
  // Who can do the chosen service: the column's person when they can, else the first who can.
  const eligible = useMemo(() => {
    const mapped = serviceId ? data.staffFor[serviceId] : undefined;
    return mapped?.length ? data.staff.filter((s) => mapped.includes(s.id)) : data.staff;
  }, [data, serviceId]);
  const [staffId, setStaffId] = useState<string>(at.staffId ?? data.staff[0]?.id ?? "");
  useEffect(() => { if (!eligible.some((s) => s.id === staffId)) setStaffId(eligible[0]?.id ?? ""); }, [eligible, staffId]);
  const service = serviceId ? data.services[serviceId] : null;
  const endMin = service ? toMin(time) + service.lengthMin : null;
  const ready = !!serviceId && !!staffId && /^\d{2}:\d{2}$/.test(time);
  const more = (() => {
    const q = new URLSearchParams({ date: at.date, time });
    if (client) q.set("clientId", client.id);
    if (serviceId) q.set("serviceId", serviceId);
    if (staffId) q.set("staffId", staffId);
    if (data.locationId) q.set("location", data.locationId);
    return `${data.newHref}?${q.toString()}`;
  })();
  const submit = (doubleBook = false) =>
    start(async () => {
      setError(null);
      const r = await quickBook({ slug: data.slug, clientId: client?.id ?? null, serviceId, staffId, date: at.date, time, locationId: data.locationId, sendConfirmation: sendConfirmation && !!client, doubleBook });
      if (!r.ok) { setError(r.error); setOverlap(!!r.overlap); return; }
      onBooked({ kind: "appointment", appointmentId: r.appointmentId, message: `Booked ${client?.name ?? "a walk-in"} at ${r.when}${service ? ` for ${service.name}` : ""}` });
    });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !pending) submit(); }}>
      <div>
        <Label>Client</Label>
        <ClientPicker slug={data.slug} initial={null} canCreate={data.canCreateClient} createClient={quickCreateClient} onPick={setClient} placeholder="Search, or leave empty for a walk-in" />
      </div>
      <div>
        <Label>Service</Label>
        <ServicePicker name="serviceId" groups={data.serviceGroups} value={serviceId || null} onPick={(id) => { setServiceId(id); setOverlap(false); }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {data.staff.length > 1 ? (
          <div>
            <Label>With</Label>
            <Select value={staffId} onChange={(e) => { setStaffId(e.target.value); setOverlap(false); }} aria-label="Provider">
              {eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        ) : null}
        <div>
          <Label>Time</Label>
          <Input type="time" value={time} onChange={(e) => { setTime(e.target.value); setOverlap(false); }} aria-label="Start time" />
        </div>
      </div>
      <p className="text-xs text-stone-500">
        {at.dateLabel}
        {service && endMin !== null ? <> · {fmt(toMin(time))} – {fmt(endMin)} ({duration(service.lengthMin)})</> : null}
        {data.staff.length === 1 && data.staff[0] ? <> · {data.staff[0].name}</> : null}
      </p>
      {client ? <Checkbox checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} label="Send the client a confirmation" /> : null}
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link href={more} className="text-sm text-brand-700 underline">More options</Link>
        <div className="flex gap-2">
          {overlap ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit(true)}>Book anyway</Button> : null}
          <Button type="submit" size="sm" disabled={!ready || pending}>{pending ? "Booking…" : "Book"}</Button>
        </div>
      </div>
    </form>
  );
}

function BlockTab({ data, at, fmt, onBooked }: { data: QuickCreateData; at: QuickCreateAt; fmt: (min: number) => string; onBooked: (r: { kind: "block"; appointmentId: string; message: string }) => void }) {
  const [staffId, setStaffId] = useState<string>(at.staffId ?? data.staff[0]?.id ?? "");
  const [startT, setStartT] = useState(hhmm(at.startMin));
  const [endT, setEndT] = useState(hhmm(at.endMin ?? Math.min(24 * 60 - 1, at.startMin + 60)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = !!staffId && toMin(endT) > toMin(startT);
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await quickBlock({ slug: data.slug, staffId, date: at.date, start: startT, end: endT, reason, locationId: data.locationId });
      if (!r.ok) { setError(r.error); return; }
      onBooked({ kind: "block", appointmentId: r.appointmentId!, message: `Blocked ${fmt(toMin(startT))} – ${fmt(toMin(endT))}${reason ? ` for ${reason}` : ""}` });
    });
  const more = `${data.blockHref}?${new URLSearchParams({ date: at.date, time: startT, ...(staffId ? { staffId } : {}), ...(data.locationId ? { location: data.locationId } : {}) }).toString()}`;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !pending) submit(); }}>
      {data.staff.length > 1 ? (
        <div>
          <Label>Who</Label>
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
            {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>From</Label><Input type="time" value={startT} onChange={(e) => setStartT(e.target.value)} aria-label="From" /></div>
        <div><Label>To</Label><Input type="time" value={endT} onChange={(e) => setEndT(e.target.value)} aria-label="To" /></div>
      </div>
      <div><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lunch" maxLength={80} /></div>
      <p className="text-xs text-stone-500">{at.dateLabel}{data.staff.length === 1 && data.staff[0] ? ` · ${data.staff[0].name}` : ""}</p>
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Link href={more} className="text-sm text-brand-700 underline">More options</Link>
        <Button type="submit" size="sm" disabled={!ready || pending}>{pending ? "Blocking…" : "Block this time"}</Button>
      </div>
    </form>
  );
}
