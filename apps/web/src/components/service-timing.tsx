"use client";
import { useState } from "react";
import { Field } from "@/components/form";
import { Input } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { describeTiming, wholeMinutes } from "@/lib/service-timing";

/**
 * How a service uses the stylist's time, in plain words, with a line that spells out what the numbers do to the calendar.
 * The waiting, finishing and clean-up fields stay folded unless the service already uses them.
 * Matches the booking rules: a wait only frees the stylist when there is a finishing block after it.
 */
export function ServiceTiming({ duration, gap, finish, buffer }: { duration: number; gap: number; finish: number; buffer: number }) {
  const [d, setD] = useState(String(duration));
  const [g, setG] = useState(String(gap));
  const [f, setF] = useState(String(finish));
  const [b, setB] = useState(String(buffer));
  const preview = describeTiming({ duration: wholeMinutes(d), gap: wholeMinutes(g), finish: wholeMinutes(f), buffer: wholeMinutes(b) });
  return (
    <div className="space-y-3">
      <Field label="Hands-on time (min)" name="durationMin" required hint="How long you work on the client first. For a simple service, this is the whole service."><Input name="durationMin" type="number" min={5} step={5} value={d} onChange={(e) => setD(e.target.value)} required /></Field>
      <Disclosure title="Waiting, finishing and clean-up time" hint="colour developing, station reset" defaultOpen={gap > 0 || finish > 0 || buffer > 0}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Waiting (min)" name="gapMin" hint="Client waits and you're free for someone else: color developing, a mask setting."><Input name="gapMin" type="number" min={0} step={5} value={g} onChange={(e) => setG(e.target.value)} /></Field>
          <Field label="Then finish (min)" name="finishMin" hint="Hands-on time after the wait: rinse, style. Needed for the wait to free you."><Input name="finishMin" type="number" min={0} step={5} value={f} onChange={(e) => setF(e.target.value)} /></Field>
          <Field label="Clean-up (min)" name="bufferAfterMin" hint="Time to reset the station after. You're busy."><Input name="bufferAfterMin" type="number" min={0} step={5} value={b} onChange={(e) => setB(e.target.value)} /></Field>
        </div>
      </Disclosure>
      <p role="status" className={`rounded-lg px-3 py-2 text-sm ${preview.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-stone-50 text-stone-700"}`}>{preview.text}</p>
    </div>
  );
}
