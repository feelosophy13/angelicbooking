"use client";
import type { ChartAnswers, ChartFieldDef } from "@angelic/core";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/form";
import { ChartFill, type ChartPhoto } from "@/components/chart-fill";
import { createChartAction, saveChartAction } from "./actions";

/**
 * Filling in a chart: a new one (posted with the client, visit, service and template) or a draft (posted with its id). Two ways out:
 * keep it as a draft, or sign it, which asks first because a signed chart is locked.
 */
export function ChartEditor({ slug, hidden, fields, answers, photos, photosHref, signerName }: {
  slug: string;
  /** noteId for a draft; clientId, appointmentId, serviceId and template for a new chart. */
  hidden: Record<string, string>;
  fields: ChartFieldDef[];
  answers: ChartAnswers;
  photos: ChartPhoto[];
  photosHref: string | null;
  signerName: string;
}) {
  return (
    <ActionForm action={hidden.noteId ? saveChartAction : createChartAction} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <ChartFill fields={fields} answers={answers} photos={photos} photosHref={photosHref} />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
        <SubmitButton variant="secondary" name="intent" value="draft" pendingText="Saving…">Save draft</SubmitButton>
        <ConfirmSubmit name="intent" value="sign" variant="primary" size="md" title="Sign this chart?" body={`Signed by ${signerName}, with today's date and time. A signed chart is locked: anything you add later is an addendum.`} confirmLabel="Sign chart">Sign chart</ConfirmSubmit>
      </div>
    </ActionForm>
  );
}
