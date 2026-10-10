import type { FormFieldDef } from "@angelic/db";

/** Read-only rendering of a signed form (staff view and the client's copy). */
export function SubmissionView({ submission, form, timeZone, clientName }: { submission: { answers: Record<string, string | boolean>; signatureName: string | null; signedAt: Date | null; createdAt: Date; ipAddress: string | null }; form: { name: string; description: string | null; fields: FormFieldDef[] }; timeZone: string; clientName: string }) {
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone });
  return (
    <div className="space-y-4 text-sm">
      {form.description ? <p className="whitespace-pre-line text-stone-700">{form.description}</p> : null}
      <dl className="divide-y divide-stone-100">
        {form.fields.filter((f) => f.type !== "statement").map((f) => {
          const v = submission.answers[f.id];
          return (
            <div key={f.id} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
              <dt className="text-stone-500">{f.label}</dt>
              <dd className="font-medium">{f.type === "checkbox" ? (v === true ? "Yes" : "No") : typeof v === "string" && v ? v : <span className="text-stone-400">—</span>}</dd>
            </div>
          );
        })}
        {form.fields.filter((f) => f.type === "statement").map((f) => <p key={f.id} className="py-2 text-stone-700">✓ {f.label}</p>)}
      </dl>
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
        {submission.signatureName ? <p>Signed <span className="font-serif text-base italic text-stone-900">{submission.signatureName}</span> by {clientName} on {fmt.format(submission.signedAt ?? submission.createdAt)}{submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p> : <p>Submitted {fmt.format(submission.createdAt)} by {clientName}{submission.ipAddress ? ` · IP ${submission.ipAddress}` : ""}</p>}
      </div>
    </div>
  );
}
