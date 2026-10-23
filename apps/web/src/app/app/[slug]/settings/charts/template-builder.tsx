"use client";
import { CHART_FIELD_TYPES, type ChartFieldDef } from "@angelic/core";
import { ChartFill } from "@/components/chart-fill";
import { FieldBuilder } from "../forms/builder";

/** The forms builder with the chart field types, and a preview of the chart as a provider fills it in. */
export function ChartTemplateBuilder({ initial }: { initial: ChartFieldDef[] }) {
  return (
    <FieldBuilder
      initial={initial}
      types={CHART_FIELD_TYPES}
      chart
      preview={(rows) => (
        <>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">How the provider fills it in</p>
          <ChartFill key={rows.map((r) => `${r.id}:${r.type}`).join()} fields={rows as ChartFieldDef[]} answers={{}} photos={[]} photosHref={null} />
        </>
      )}
    />
  );
}
