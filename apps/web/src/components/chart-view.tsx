import { CHART_DISPLAY_TYPES, chartAnswerText, type ChartAnswers, type ChartFieldDef, type ChartMark } from "@angelic/core";
import { ChartDiagramView } from "@/components/chart-diagram";
import { cn } from "@/lib/utils";

export type ChartViewPhoto = { id: string; fileId: string; thumbFileId: string | null; phase: string };

/**
 * A chart as recorded, read-only: on the chart page, the print copy and the "last time" reference. Blank answers are left out unless
 * `showBlank`, so a short chart reads short. Section headings stay, and a section with nothing in it is dropped.
 */
export function ChartView({ fields, answers, photos = [], showBlank = false, compact = false }: { fields: ChartFieldDef[]; answers: ChartAnswers; photos?: ChartViewPhoto[]; showBlank?: boolean; compact?: boolean }) {
  const has = (f: ChartFieldDef) => !CHART_DISPLAY_TYPES.includes(f.type) && chartAnswerText(f, answers[f.id]) !== "";
  // Keep a heading only when something under it (up to the next heading) has an answer.
  const shown = fields.filter((f, i) => {
    if (f.type === "statement") return false;
    if (f.type !== "heading") return showBlank || has(f);
    for (let j = i + 1; j < fields.length && fields[j]!.type !== "heading"; j++) if (showBlank || has(fields[j]!)) return true;
    return false;
  });
  if (!shown.length) return <p className="text-sm text-stone-500">Nothing recorded.</p>;
  const byId = new Map(photos.map((p) => [p.id, p]));
  return (
    <dl className={cn("space-y-3", compact && "space-y-2")}>
      {shown.map((f) => {
        if (f.type === "heading") return <h3 key={f.id} className="border-b border-stone-200 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-stone-500 first:pt-0">{f.label}</h3>;
        const v = answers[f.id];
        let body: React.ReactNode;
        if (f.type === "diagram") body = <ChartDiagramView kind={f.diagram ?? "face"} marks={Array.isArray(v) ? (v as ChartMark[]) : []} className={compact ? "sm:grid-cols-[8rem_1fr]" : undefined} />;
        else if (f.type === "photo") {
          const picked = (Array.isArray(v) ? (v as string[]) : []).map((id) => byId.get(id)).filter((p): p is ChartViewPhoto => !!p);
          body = picked.length ? (
            <ul className="flex flex-wrap gap-2">
              {picked.map((p) => (
                <li key={p.id}>
                  <a href={`/api/files/${p.fileId}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-stone-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${p.thumbFileId ?? p.fileId}`} alt={`${p.phase} photo`} width={compact ? 72 : 120} height={compact ? 72 : 120} loading="lazy" className={cn("object-cover", compact ? "h-18 w-18" : "h-30 w-30")} />
                  </a>
                </li>
              ))}
            </ul>
          ) : <span className="text-stone-400">{Array.isArray(v) && v.length ? "Photo removed from the visit" : "—"}</span>;
        } else {
          const t = chartAnswerText(f, v);
          body = t ? <span className="whitespace-pre-line">{t}</span> : <span className="text-stone-400">—</span>;
        }
        return (
          <div key={f.id} className="break-inside-avoid">
            <dt className="text-xs text-stone-500">{f.label}</dt>
            <dd className="text-sm text-stone-900">{body}</dd>
          </div>
        );
      })}
    </dl>
  );
}
