"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { Input, Notice, Select, Textarea, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { fieldVisible } from "@/lib/forms-logic";

export type FillState = { error?: string; ok?: boolean } | undefined;
type Action = (prev: FillState, formData: FormData) => Promise<FillState>;

/**
 * Fills an intake/consent form: used on the client's own phone (public page)
 * and at the front desk (staff page). Questions can depend on earlier answers,
 * previous answers prefill, files attach, and the signature is typed and drawn.
 */
export function FormFill({ action, hidden, form, defaults, clientName, submitLabel, staffMode = false, before }: {
  action: Action;
  hidden: Record<string, string>;
  /** Extra inputs rendered above the questions (e.g. who is filling in a shared form). */
  before?: React.ReactNode;
  form: { id: string; name: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean };
  defaults?: Record<string, FormAnswer> | null;
  clientName: string;
  submitLabel?: string;
  staffMode?: boolean;
}) {
  const [state, act] = useActionState<FillState, FormData>(action, undefined);
  const [answers, setAnswers] = useState<Record<string, FormAnswer | undefined>>(() => Object.fromEntries(form.fields.map((f) => [f.id, defaults?.[f.id]])));
  const set = (id: string, v: FormAnswer | undefined) => setAnswers((a) => ({ ...a, [id]: v }));
  if (state?.ok) return <Notice kind="success">Thanks, {form.name} is complete.</Notice>;
  const prefilled = !!defaults && Object.keys(defaults).length > 0;
  return (
    <form action={act} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {form.description ? <p className="whitespace-pre-line text-sm text-stone-700">{form.description}</p> : null}
      {before}
      {prefilled ? <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">We filled in your answers from last time. Please check they are still right.</p> : null}
      {form.fields.map((f) => {
        if (!fieldVisible(f, answers)) return null;
        const name = `a_${f.id}`;
        const v = answers[f.id];
        if (f.type === "statement") return <p key={f.id} className="text-sm text-stone-700">{f.label}</p>;
        if (f.type === "checkbox") {
          return (
            <Checkbox key={f.id} name={name} required={f.required} checked={v === true} onChange={(e) => set(f.id, e.target.checked)} label={<>{f.label}{f.required ? " *" : ""}</>} />
          );
        }
        if (f.type === "multiselect") {
          const picked = Array.isArray(v) ? v : [];
          return (
            <fieldset key={f.id} className="text-sm">
              <legend className="mb-1 font-medium text-stone-700">{f.label}{f.required ? " *" : ""}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(f.options ?? []).map((o) => (
                  <Checkbox key={o} name={name} value={o} checked={picked.includes(o)} onChange={(e) => set(f.id, e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} label={o} />
                ))}
              </div>
            </fieldset>
          );
        }
        if (f.type === "file") {
          const kept = typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : "";
          return (
            <label key={f.id} className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">{f.label}{f.required ? " *" : ""}</span>
              {kept ? <span className="mb-1 block text-xs text-stone-500">A file from last time is attached. <a href={`/api/files/${kept}`} target="_blank" rel="noreferrer" className="underline">View</a> · choose a new one to replace it.</span> : null}
              {kept ? <input type="hidden" name={`${name}_keep`} value={kept} /> : null}
              <input type="file" name={name} accept="image/*,application/pdf" capture={staffMode ? undefined : "environment"} required={f.required && !kept} className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
              <span className="mt-1 block text-xs text-stone-500">Photo or PDF, up to 5 MB.</span>
            </label>
          );
        }
        return (
          <label key={f.id} className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">{f.label}{f.required ? " *" : ""}</span>
            {f.type === "textarea" ? (
              <Textarea name={name} rows={3} required={f.required} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value)} />
            ) : f.type === "select" ? (
              <Select name={name} required={f.required} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value)}>
                <option value="" disabled>Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : (
              <Input name={name} type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} step={f.type === "number" ? "any" : undefined} required={f.required} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value)} />
            )}
          </label>
        );
      })}
      {form.requireSignature ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">Type your full name to sign *</span>
            <Input name="signatureName" placeholder={clientName} required className="font-serif italic" autoComplete="name" />
          </label>
          <SignaturePad />
          <p className="text-xs text-stone-500">By signing you agree this is your electronic signature{staffMode ? ", completed with a staff member's help" : ""}.</p>
        </div>
      ) : null}
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Saving…">{submitLabel ?? (form.requireSignature ? "Sign and submit" : "Submit")}</SubmitButton>
    </form>
  );
}

/** Finger/mouse signature on a canvas; posts a PNG data URL as `signatureImage` (empty when untouched). */
function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const drawing = useRef(false);
  const drew = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1917";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = pos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drew.current = true;
    last.current = p;
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    last.current = null;
    // Only a pad that was actually drawn on posts an image; a pointer crossing it does not.
    if (drew.current) setDataUrl(e.currentTarget.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    drew.current = false;
    setDataUrl("");
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">Draw your signature</span>
        <button type="button" onClick={clear} className="text-xs text-stone-500 underline">Clear</button>
      </div>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="mt-1 h-32 w-full touch-none rounded-lg border border-stone-300 bg-white" aria-label="Signature pad" />
      <input type="hidden" name="signatureImage" value={dataUrl} />
    </div>
  );
}
