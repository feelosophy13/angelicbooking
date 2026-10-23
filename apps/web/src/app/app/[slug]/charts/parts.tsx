import Link from "next/link";
import type { ChartAnswers, ChartFieldDef } from "@angelic/core";
import { Disclosure } from "@/components/disclosure";
import { ChartView } from "@/components/chart-view";
import type { ChartNoteRow } from "@/server/charts";

/** "Signed by Jordan · Oct 3, 2026, 2:14 PM" or "Draft · started by Jordan". */
export function chartStatusLine(note: Pick<ChartNoteRow, "signedAt" | "signedByName" | "authorName">, timeZone: string): string {
  if (!note.signedAt) return `Draft · started by ${note.authorName}`;
  return `Signed by ${note.signedByName ?? note.authorName} · ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(note.signedAt)}`;
}

export function ChartStatusBadge({ signed }: { signed: boolean }) {
  return signed
    ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Signed</span>
    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Draft</span>;
}

/** The client's last signed chart for the same service, folded away above the chart being written, for a quick look. */
export function LastTime({ slug, note, timeZone, copyHref }: { slug: string; note: ChartNoteRow | null; timeZone: string; copyHref?: string | null }) {
  if (!note) return null;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(note.signedAt ?? note.createdAt);
  return (
    <Disclosure variant="inset" title={`Last time: ${note.serviceName ?? note.templateSnapshot.name}`} hint={`${when} · ${note.signedByName ?? note.authorName}`} className="mb-5">
      <ChartView fields={note.templateSnapshot.fields as ChartFieldDef[]} answers={note.answers as ChartAnswers} compact />
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/app/${slug}/charts/${note.id}`} className="text-brand-700 underline">Open that chart</Link>
        {copyHref ? <Link href={copyHref} className="text-brand-700 underline">Start from its answers</Link> : null}
      </p>
    </Disclosure>
  );
}
