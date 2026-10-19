import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { answerText, answersEqual, fieldVisible } from "@/lib/forms-logic";

/** Read-only rendering of a signed form (staff view, print view and the client's copy). */
export function SubmissionView({ submission, form, timeZone, clientName, previous, assistedByName, showIp = false }: {
  /** Print the signer's IP address (staff with "See the activity log" only; never on the client's copy). */
  showIp?: boolean;
  submission: { answers: Record<string, FormAnswer>; signatureName: string | null; signatureFileId?: string | null; signedAt: Date | null; createdAt: Date; ipAddress: string | null; voidedAt?: Date | null; voidReason?: string | null };
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
    <div className={`space-y-4 text-sm ${submission.voidedAt ? "opacity-70" : ""}`}>
      {submission.voidedAt ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800"><b>Voided</b> {fmt.format(submission.voidedAt)}{submission.voidReason ? ` · ${submission.voidReason}` : ""}. It no longer counts as signed.</p> : null}
      {form.description ? <p className="whitespace-pre-line text-stone-700">{form.description}</p> : null}
      <dl className="divide-y divide-stone-100">
        {form.fields.map((f) => {
          // Questions hidden by the client's own answers were never asked, so they are not listed.
          if (!fieldVisible(f, submission.answers)) return null;
          if (f.type === "heading") return <h3 key={f.id} className="pb-1 pt-3 text-sm font-semibold text-stone-900">{f.label}</h3>;
          if (f.type === "statement") return <p key={f.id} className="whitespace-pre-line py-2 text-stone-700">{f.label}</p>;
          const v = submission.answers[f.id];
          const changed = previous ? !answersEqual(v, previous.answers[f.id]) : false;
          return (
            <div key={f.id} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
              <dt className="text-stone-500">{f.label}</dt>
              <dd className={f.type === "initials" ? "font-serif text-base italic" : "font-medium"}>
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
      </dl>
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        {submission.signatureFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${submission.signatureFileId}`} alt="Signature" className="mb-2 h-20 rounded border border-stone-200 bg-white" />
        ) : null}
        {submission.signatureName ? (
          <p>Signed <span className="font-serif text-base italic text-stone-900">{submission.signatureName}</span> by {clientName} on {fmt.format(submission.signedAt ?? submission.createdAt)}{showIp && submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p>
        ) : (
          <p>Submitted {fmt.format(submission.createdAt)} by {clientName}{showIp && submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p>
        )}
        {assistedByName ? <p>Completed at the front desk with {assistedByName}.</p> : null}
        {previous ? <p>Previous copy: {fmt.format(previous.createdAt)}. Answers marked “changed” differ from it.</p> : null}
      </div>
    </div>
  );
}
