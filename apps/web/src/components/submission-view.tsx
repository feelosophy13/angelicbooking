import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { answerText, answersEqual } from "@/lib/forms-logic";

/** Read-only rendering of a signed form (staff view, print view and the client's copy). */
export function SubmissionView({ submission, form, timeZone, clientName, previous, assistedByName }: {
  submission: { answers: Record<string, FormAnswer>; signatureName: string | null; signatureFileId?: string | null; signedAt: Date | null; createdAt: Date; ipAddress: string | null };
  form: { name: string; description: string | null; fields: FormFieldDef[] };
  timeZone: string;
  clientName: string;
  /** The client's previous copy of the same form, to flag what changed. */
  previous?: { answers: Record<string, FormAnswer>; createdAt: Date } | null;
  assistedByName?: string | null;
}) {
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone });
  const isFile = (v: FormAnswer | undefined): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
  return (
    <div className="space-y-4 text-sm">
      {form.description ? <p className="whitespace-pre-line text-stone-700">{form.description}</p> : null}
      <dl className="divide-y divide-stone-100">
        {form.fields.filter((f) => f.type !== "statement").map((f) => {
          const v = submission.answers[f.id];
          const changed = previous ? !answersEqual(v, previous.answers[f.id]) : false;
          return (
            <div key={f.id} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
              <dt className="text-stone-500">{f.label}</dt>
              <dd className="font-medium">
                {f.type === "file" ? (
                  isFile(v) ? <a href={`/api/files/${v}`} target="_blank" rel="noreferrer" className="text-brand-700 underline">View attachment</a> : <span className="text-stone-400">—</span>
                ) : (
                  answerText(f, v) || <span className="text-stone-400">—</span>
                )}
                {changed ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800" title={`Was: ${answerText(f, previous!.answers[f.id]) || "—"}`}>changed</span> : null}
              </dd>
            </div>
          );
        })}
        {form.fields.filter((f) => f.type === "statement").map((f) => <p key={f.id} className="py-2 text-stone-700">✓ {f.label}</p>)}
      </dl>
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        {submission.signatureFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${submission.signatureFileId}`} alt="Signature" className="mb-2 h-20 rounded border border-stone-200 bg-white" />
        ) : null}
        {submission.signatureName ? (
          <p>Signed <span className="font-serif text-base italic text-stone-900">{submission.signatureName}</span> by {clientName} on {fmt.format(submission.signedAt ?? submission.createdAt)}{submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p>
        ) : (
          <p>Submitted {fmt.format(submission.createdAt)} by {clientName}{submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p>
        )}
        {assistedByName ? <p>Completed at the front desk with {assistedByName}.</p> : null}
        {previous ? <p>Previous copy: {fmt.format(previous.createdAt)}. Answers marked “changed” differ from it.</p> : null}
      </div>
    </div>
  );
}
