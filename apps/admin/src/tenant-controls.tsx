"use client";

import { useActionState, useTransition } from "react";
import { compAction, extendTrialAction, reactivateAction, suspendAction, type ActionState } from "@/app/tenants/[id]/actions";
import { BTN, BTN_DANGER, INPUT } from "@/ui/kit";

function Msg({ s }: { s: ActionState }) {
  if (s?.error) return <p role="alert" className="mt-2 text-sm text-bad">{s.error}</p>;
  if (s?.ok) return <p role="status" className="mt-2 text-sm text-good">{s.ok}</p>;
  return null;
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line pb-4 last:border-0 last:pb-0">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

export function TenantControls(props: { id: string; name: string; suspended: boolean; comped: boolean; hasSubscription: boolean }) {
  const { id, name, suspended, comped, hasSubscription } = props;
  const [suspendState, suspend, suspending] = useActionState(suspendAction.bind(null, id), null);
  const [trialState, extend, extending] = useActionState(extendTrialAction.bind(null, id), null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4 text-sm">
      <Row title="Access">
        <p className="mt-0.5 text-ink-2">{suspended ? "Suspended. The staff app, booking page and messages are closed; data is kept." : "Active."}</p>
        {suspended ? (
          <div className="mt-2"><button className={BTN} disabled={pending} onClick={() => start(async () => void (await reactivateAction(id)))}>Reactivate</button></div>
        ) : (
          <form action={suspend} onSubmit={(e) => { if (!confirm(`Suspend ${name}? Their staff app and booking page close immediately.`)) e.preventDefault(); }} className="mt-2 space-y-2">
            <input name="reason" placeholder="Reason (only you see it)" maxLength={300} className={INPUT} aria-label="Reason for suspending" />
            <button className={BTN_DANGER} disabled={suspending}>Suspend</button>
          </form>
        )}
        <Msg s={suspendState} />
      </Row>
      <Row title="Billing">
        <p className="mt-0.5 text-ink-2">{comped ? "Comped: never charged." : "Charged from the price book."}</p>
        <div className="mt-2"><button className={BTN} disabled={pending} onClick={() => start(async () => void (await compAction(id, !comped)))}>{comped ? "Remove comp" : "Comp this business"}</button></div>
      </Row>
      <Row title="Free trial">
        {hasSubscription ? (
          <p className="mt-0.5 text-ink-2">Has a Stripe subscription; change the trial in Stripe.</p>
        ) : (
          <form action={extend} className="mt-2 flex items-center gap-2">
            <label htmlFor="days" className="text-ink-2">Extend by</label>
            <input id="days" name="days" inputMode="numeric" defaultValue="14" className={`${INPUT} w-20`} />
            <span className="text-ink-2">days</span>
            <button className={BTN} disabled={extending}>Extend</button>
          </form>
        )}
        <Msg s={trialState} />
      </Row>
    </div>
  );
}
