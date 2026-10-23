"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Checkbox } from "@/components/ui";
import { sendFillAction } from "./actions";

export type OpeningView = {
  key: string;
  staffId: string;
  staffName: string;
  start: string;
  locationId: string | null;
  when: string;
  meta: string;
  remaining: number;
  invited: { name: string; ago: string; booked: boolean }[];
  suggestions: { clientId: string; name: string; reason: "waitlist" | "overdue" | "regular"; detail: string; serviceName: string; channel: "sms" | "email" | null; blocked: string | null }[];
};

const REASON: Record<OpeningView["suggestions"][number]["reason"], string> = { waitlist: "Waitlist", overdue: "Due back", regular: "Regular" };
const REASON_CLASS: Record<OpeningView["suggestions"][number]["reason"], string> = { waitlist: "bg-emerald-50 text-emerald-700", overdue: "bg-amber-50 text-amber-800", regular: "bg-sky-50 text-sky-700" };

/**
 * One opening: when, who, how long; the clients suggested for it, the best ones ticked up to what the opening can still take; and
 * Send. Clients consent doesn't let us reach are listed without a box, with the reason.
 */
export function OpeningCard({ slug, o }: { slug: string; o: OpeningView }) {
  const reachable = o.suggestions.filter((s) => s.channel);
  const [ticked, setTicked] = useState(() => new Set(reachable.slice(0, o.remaining).map((s) => s.clientId)));
  const over = ticked.size > o.remaining;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium text-stone-900">{o.when} · {o.staffName}</p>
        <p className="text-xs text-stone-500">{o.meta}</p>
      </div>
      {o.invited.length ? (
        <p className="mt-1 text-xs text-stone-500">Invited: {o.invited.map((i) => `${i.name} (${i.booked ? "booked" : i.ago})`).join(", ")}</p>
      ) : null}
      {o.suggestions.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">{o.invited.length ? "Nobody else fits this opening right now." : "No waitlist, due-back clients or regulars fit this opening."}</p>
      ) : o.remaining === 0 ? (
        <p className="mt-3 text-sm text-stone-500">This opening has all the invitations it can take.</p>
      ) : (
        <ActionForm action={sendFillAction} className="mt-3 space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="staffId" value={o.staffId} />
          <input type="hidden" name="start" value={o.start} />
          {o.locationId ? <input type="hidden" name="locationId" value={o.locationId} /> : null}
          <ul className="space-y-2.5">
            {o.suggestions.map((s) => {
              const label = (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{s.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REASON_CLASS[s.reason]}`}>{REASON[s.reason]}</span>
                </span>
              );
              const hint = `${s.detail} · ${s.serviceName}${s.channel ? ` · by ${s.channel === "sms" ? "text" : "email"}` : ""}`;
              return (
                <li key={s.clientId}>
                  {s.channel ? (
                    <Checkbox
                      name="clientId"
                      value={s.clientId}
                      checked={ticked.has(s.clientId)}
                      onChange={(e) => setTicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(s.clientId); else next.delete(s.clientId); return next; })}
                      label={label}
                      hint={hint}
                    />
                  ) : (
                    <div className="pl-[26px] text-sm text-stone-500">
                      <span className="flex flex-wrap items-center gap-1.5">{s.name} <span className="text-xs">· can&apos;t invite: {s.blocked}</span></span>
                      <span className="block text-xs">{s.detail}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="secondary" size="sm" pendingText="Sending…" disabled={!ticked.size || over}>
              {ticked.size ? `Send to ${ticked.size}` : "Send"}
            </SubmitButton>
            <span className={`text-xs ${over ? "text-red-600" : "text-stone-500"}`}>{over ? `This opening can take ${o.remaining} more.` : `Up to ${o.remaining} more for this opening.`}</span>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
