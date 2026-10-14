"use client";

import { useActionState, useTransition } from "react";
import { compAction, extendTrialAction, reactivateAction, suspendAction, type ActionState } from "@/app/tenants/[id]/actions";

const BTN = "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-60";
const DANGER = "rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60";

function Msg({ s }: { s: ActionState }) {
  if (s?.error) return <p role="alert" className="text-sm text-red-700">{s.error}</p>;
  if (s?.ok) return <p role="status" className="text-sm text-emerald-700">{s.ok}</p>;
  return null;
}

export function TenantControls(props: { id: string; name: string; suspended: boolean; comped: boolean; hasSubscription: boolean }) {
  const { id, name, suspended, comped, hasSubscription } = props;
  const [suspendState, suspend, suspending] = useActionState(suspendAction.bind(null, id), null);
  const [trialState, extend, extending] = useActionState(extendTrialAction.bind(null, id), null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-5 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <div>
        <div className="font-medium">Access</div>
        <p className="text-stone-600">{suspended ? "Suspended: the staff app and the booking page are closed and no texts or emails go out. Data is kept." : "Active."}</p>
        {suspended ? (
          <div className="mt-2"><button className={BTN} disabled={pending} onClick={() => start(async () => void (await reactivateAction(id)))}>Reactivate</button></div>
        ) : (
          <form
            action={suspend}
            onSubmit={(e) => { if (!confirm(`Suspend ${name}? Their staff app and booking page close immediately.`)) e.preventDefault(); }}
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <input name="reason" placeholder="Reason (optional, shown only to you)" maxLength={300} className="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
            <button className={DANGER} disabled={suspending}>Suspend</button>
          </form>
        )}
        <Msg s={suspendState} />
      </div>
      <div>
        <div className="font-medium">Billing</div>
        <p className="text-stone-600">{comped ? "Comped: never charged." : "Charged from the price book."}</p>
        <div className="mt-2"><button className={BTN} disabled={pending} onClick={() => start(async () => void (await compAction(id, !comped)))}>{comped ? "Remove comp" : "Comp this business"}</button></div>
      </div>
      <div>
        <div className="font-medium">Free trial</div>
        {hasSubscription ? (
          <p className="text-stone-600">Has a Stripe subscription; change the trial in Stripe.</p>
        ) : (
          <form action={extend} className="mt-1 flex items-center gap-2">
            <label className="text-stone-600" htmlFor="days">Extend by</label>
            <input id="days" name="days" inputMode="numeric" defaultValue="14" className="w-20 rounded-md border border-stone-300 px-3 py-1.5" />
            <span className="text-stone-600">days</span>
            <button className={BTN} disabled={extending}>Extend</button>
          </form>
        )}
        <Msg s={trialState} />
      </div>
    </div>
  );
}
