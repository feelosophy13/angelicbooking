import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCancellationReasons } from "@/server/cancellation-reasons";
import { BackLink, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { addCancellationReason, moveCancellationReasonAction, renameCancellationReasonAction, setCancellationReasonActiveAction, setCancellationReasonClientVisibleAction } from "./actions";

export const metadata: Metadata = { title: "Cancellation reasons" };

/** The short list picked when an appointment is cancelled. */
export default async function CancellationReasonsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "settings.business");
  const reasons = await listCancellationReasons(business.id, { includeRetired: true });
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Cancellation reasons" />
      <Card className="max-w-2xl p-4">
        <p className="mb-3 text-sm text-stone-600">Picked when an appointment is cancelled (and offered to clients on their cancel page) so Reports can group cancellations by cause. Rename, reorder or retire; retired reasons keep their history on old cancellations.</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {reasons.map((r, i) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-2 py-2 ${r.active ? "" : "text-stone-400"}`}>
                {r.active ? (
                  <ActionForm action={renameCancellationReasonAction} className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={r.id} />
                    <Input name="name" defaultValue={r.name} className="h-8 min-w-0 flex-1" aria-label={`Rename ${r.name}`} />
                    <SubmitButton size="sm" variant="ghost" pendingText="…">Rename</SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="min-w-0 flex-1 truncate px-3">{r.name} · retired</span>
                )}
                {r.active ? (
                  <form action={moveCancellationReasonAction} className="flex gap-0.5">
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={r.id} />
                    <button name="dir" value="up" disabled={i === 0} aria-label={`Move ${r.name} up`} className="hit rounded px-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30">↑</button>
                    <button name="dir" value="down" disabled={i === reasons.length - 1} aria-label={`Move ${r.name} down`} className="hit rounded px-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30">↓</button>
                  </form>
                ) : null}
                {r.active ? (
                  <form action={setCancellationReasonClientVisibleAction}>
                    <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="visible" value={r.clientVisible ? "0" : "1"} />
                    <button className="text-xs text-stone-500 underline hover:text-stone-800" title="Whether clients can pick this on their cancel page">{r.clientVisible ? "Shown to clients" : "Staff only"}</button>
                  </form>
                ) : null}
                <form action={setCancellationReasonActiveAction}>
                  <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} />
                  <button className="text-xs text-stone-500 underline hover:text-stone-800">{r.active ? "Retire" : "Restore"}</button>
                </form>
              </li>
            ))}
          </ul>
          <ActionForm action={addCancellationReason} className="mt-3 flex items-end gap-2 border-t border-stone-200 pt-3">
            <input type="hidden" name="slug" value={slug} />
            <Field label="New reason" name="name"><Input name="name" placeholder="Weather" className="h-9" /></Field>
            <SubmitButton size="sm" variant="secondary" pendingText="Adding…">Add</SubmitButton>
          </ActionForm>
      </Card>
    </>
  );
}
