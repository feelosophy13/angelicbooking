import { Disclosure } from "@/components/disclosure";
import type { ActivityEvent, ActivitySummary } from "@/server/activity";

/**
 * "Who did what" for an appointment or ticket: one line that is always visible (booked by, last
 * status change, paid by), and the full log behind a disclosure.
 */
export function ActivityTrail({ summary, events, timeZone, mode }: { summary: ActivitySummary; events: ActivityEvent[]; timeZone: string; mode: "appointment" | "sale" }) {
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone });
  const parts: string[] = [];
  if (summary.bookedBy) parts.push(`${summary.bookedBy.source === "online" ? "Booked online" : summary.bookedBy.source === "import" ? "Imported" : "Booked"} by ${summary.bookedBy.actor}, ${when.format(summary.bookedBy.at)}`);
  if (summary.lastStatus) parts.push(`${summary.lastStatus.actor} ${summary.lastStatus.what}, ${when.format(summary.lastStatus.at)}${summary.lastStatus.detail ? ` (${summary.lastStatus.detail})` : ""}`);
  if (summary.paidBy) parts.push(`${mode === "sale" ? "Closed" : "Paid"} by ${summary.paidBy.actor}, ${when.format(summary.paidBy.at)}`);
  if (!events.length) return null;
  return (
    <div className="space-y-2">
      {parts.length ? <p className="text-xs text-stone-500">{parts.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" · ")}</p> : null}
      <Disclosure title="Full history" hint={`${events.length} ${events.length === 1 ? "event" : "events"}`} className="[&>div]:p-0">
        <ol className="divide-y divide-stone-100 text-sm">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
              <span className="w-40 shrink-0 text-xs tabular-nums text-stone-500">{when.format(e.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{e.actor.charAt(0).toUpperCase() + e.actor.slice(1)}</span> {e.what}
                {e.detail ? <span className="text-stone-500"> · {e.detail}</span> : null}
                {mode === "appointment" && e.onTicket ? <span className="ml-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">ticket</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Disclosure>
    </div>
  );
}
