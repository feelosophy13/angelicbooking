"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { Input, Notice, Select, Textarea, Checkbox } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { clearHidden, fieldVisible } from "@/lib/forms-logic";
import { cn } from "@/lib/utils";

export type FillState = { error?: string; field?: string | null; ok?: boolean } | undefined;
type Action = (prev: FillState, formData: FormData) => Promise<FillState>;

/**
 * Fills an intake/consent form: used on the client's own phone (public page)
 * and at the front desk (staff page). Questions can depend on earlier answers,
 * previous answers prefill, files attach, and the signature is typed and drawn.
 * A failed submit shows the message under the question it is about.
 */
export function FormFill({ action, hidden, form, defaults, clientName, submitLabel, staffMode = false, before, next, preview = false }: {
  action: Action;
  hidden: Record<string, string>;
  /** Extra inputs rendered above the questions (e.g. who is filling in a shared form). */
  before?: React.ReactNode;
  form: { id: string; name: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean };
  defaults?: Record<string, FormAnswer> | null;
  clientName: string;
  submitLabel?: string;
  staffMode?: boolean;
  /** Where to go after this one is done, e.g. the next outstanding form. */
  next?: { href: string; label: string } | null;
  /** Builder preview: looks real, submits nowhere. */
  preview?: boolean;
}) {
  const [state, act] = useActionState<FillState, FormData>(action, undefined);
  const [answers, setAnswers] = useState<Record<string, FormAnswer | undefined>>(() => Object.fromEntries(form.fields.map((f) => [f.id, defaults?.[f.id]])));
  const set = (id: string, v: FormAnswer | undefined) => setAnswers((a) => clearHidden(form.fields, { ...a, [id]: v }));
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    const el = formRef.current?.querySelector<HTMLElement>(state.field ? `[data-q="${state.field}"]` : "[role=alert]");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);
  if (state?.ok) {
    return (
      <Notice kind="success">
        Thanks, {form.name} is complete.
        {next ? <> <Link href={next.href} className="font-medium underline">Next: {next.label} →</Link></> : null}
      </Notice>
    );
  }
  const prefilled = !!defaults && Object.keys(defaults).length > 0;
  const errorFor = (id: string) => (state?.error && state.field === id ? state.error : null);
  const Err = ({ id }: { id: string }) => {
    const e = errorFor(id);
    return e ? <p className="mt-1 text-xs text-red-600" role="alert">{e}</p> : null;
  };
  const req = (f: FormFieldDef) => (f.required ? <span className="text-red-500"> *</span> : null);
  const label = (f: FormFieldDef) => <span className="mb-1 block font-medium text-stone-700">{f.label}{req(f)}</span>;
  const boxClass = (id: string) => cn(errorFor(id) && "[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400");
  // The builder's preview sits inside the editor's own <form>, so it renders as a plain block.
  const Wrap = preview ? "div" : "form";
  const wrapProps = preview ? {} : { action: act };
  return (
    <Wrap ref={formRef as React.RefObject<HTMLFormElement & HTMLDivElement>} className="space-y-4" {...wrapProps}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {form.description ? <p className="whitespace-pre-line text-sm text-stone-700">{form.description}</p> : null}
      {before}
      {prefilled ? <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">We filled in your answers from last time. Please check they are still right.</p> : null}
      {form.fields.map((f) => {
        if (!fieldVisible(f, answers)) return null;
        const name = preview ? undefined : `a_${f.id}`;
        const v = answers[f.id];
        if (f.type === "heading") return <h3 key={f.id} className="border-b border-stone-200 pb-1 pt-2 text-base font-semibold text-stone-900">{f.label}</h3>;
        if (f.type === "statement") return <p key={f.id} className="whitespace-pre-line text-sm text-stone-700">{f.label}</p>;
        if (f.type === "checkbox") {
          return (
            <div key={f.id} data-q={f.id} className={boxClass(f.id)}>
              <Checkbox name={name} checked={v === true} onChange={(e) => set(f.id, e.target.checked)} label={<>{f.label}{req(f)}</>} />
              <Err id={f.id} />
            </div>
          );
        }
        if (f.type === "yesno") {
          return (
            <fieldset key={f.id} data-q={f.id} className="text-sm">
              <legend className="mb-1 font-medium text-stone-700">{f.label}{req(f)}</legend>
              <div className="flex gap-2">
                {(["Yes", "No"] as const).map((o) => (
                  <label key={o} className={cn("flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center", v === o ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-stone-300 bg-white hover:bg-stone-50", errorFor(f.id) && "border-red-400")}>
                    <input type="radio" name={name} value={o} checked={v === o} onChange={() => set(f.id, o)} className="sr-only" />
                    {o}
                  </label>
                ))}
              </div>
              <Err id={f.id} />
            </fieldset>
          );
        }
        if (f.type === "multiselect") {
          const picked = Array.isArray(v) ? v : [];
          return (
            <fieldset key={f.id} data-q={f.id} className="text-sm">
              <legend className="mb-1 font-medium text-stone-700">{f.label}{req(f)}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(f.options ?? []).filter(Boolean).map((o) => (
                  <Checkbox key={o} name={name} value={o} checked={picked.includes(o)} onChange={(e) => set(f.id, e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} label={o} />
                ))}
              </div>
              <Err id={f.id} />
            </fieldset>
          );
        }
        if (f.type === "file") {
          const kept = typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : "";
          return (
            <label key={f.id} data-q={f.id} className="block text-sm">
              {label(f)}
              {kept ? <span className="mb-1 block text-xs text-stone-500">A file from last time is attached. <a href={`/api/files/${kept}`} target="_blank" rel="noreferrer" className="underline">View</a> · choose a new one to replace it.</span> : null}
              {kept && name ? <input type="hidden" name={`${name}_keep`} value={kept} /> : null}
              <input type="file" name={name} accept="image/*,application/pdf" capture={staffMode ? undefined : "environment"} className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
              <span className="mt-1 block text-xs text-stone-500">Photo or PDF, up to 5 MB.</span>
              <Err id={f.id} />
            </label>
          );
        }
        if (f.type === "initials") {
          return (
            <label key={f.id} data-q={f.id} className={cn("flex items-center gap-3 text-sm", boxClass(f.id))}>
              <Input name={name} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value.toUpperCase().slice(0, 5))} maxLength={5} placeholder="JS" autoComplete="off" className="w-20 text-center font-serif text-base uppercase italic" />
              <span className="text-stone-600">{f.label}{req(f)}</span>
              <Err id={f.id} />
            </label>
          );
        }
        return (
          <label key={f.id} data-q={f.id} className={cn("block text-sm", boxClass(f.id))}>
            {label(f)}
            {f.type === "textarea" ? (
              <Textarea name={name} rows={4} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value)} />
            ) : f.type === "select" ? (
              <Select name={name} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : (
              <Input
                name={name}
                type={f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "phone" ? "tel" : f.type === "email" ? "email" : "text"}
                inputMode={f.type === "number" ? "decimal" : f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
                autoComplete={f.type === "phone" ? "tel" : f.type === "email" ? "email" : f.type === "date" && /birth/i.test(f.label) ? "bday" : undefined}
                step={f.type === "number" ? "any" : undefined}
                value={typeof v === "string" ? v : ""}
                onChange={(e) => set(f.id, e.target.value)}
              />
            )}
            <Err id={f.id} />
          </label>
        );
      })}
      {form.requireSignature ? (
        <div className="space-y-2" data-q="signatureName">
          <label className={cn("block text-sm", boxClass("signatureName"))}>
            <span className="mb-1 block font-medium text-stone-700">Type your full name to sign <span className="text-red-500">*</span></span>
            <Input name={preview ? undefined : "signatureName"} placeholder={clientName} className="font-serif italic" autoComplete="name" />
            <Err id="signatureName" />
          </label>
          <SignaturePad named={!preview} />
          <p className="text-xs text-stone-500">By signing you agree this is your electronic signature{staffMode ? ", completed with a staff member's help" : ""}.</p>
        </div>
      ) : null}
      {state?.error && !state.field ? <Notice>{state.error}</Notice> : null}
      {state?.error && state.field ? <p className="text-xs text-red-600">Please check the highlighted question above.</p> : null}
      {preview ? (
        <button type="button" disabled className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white opacity-80" style={{ background: "var(--brand)" }}>{submitLabel ?? (form.requireSignature ? "Sign and submit" : "Submit")}</button>
      ) : (
        <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Saving…">{submitLabel ?? (form.requireSignature ? "Sign and submit" : "Submit")}</SubmitButton>
      )}
    </Wrap>
  );
}

/**
 * Finger/mouse signature on a canvas; posts a PNG data URL as `signatureImage` (empty when
 * untouched). The drawing survives a phone rotation: on resize the strokes are redrawn scaled.
 */
function SignaturePad({ named = true }: { named?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState("");
  const drawing = useRef(false);
  const drew = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<string>("");
  const setup = (c: HTMLCanvasElement) => {
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c1917";
    return ctx;
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    setup(c);
    const ro = new ResizeObserver(() => {
      const prev = snapshot.current;
      const ctx = setup(c);
      if (!prev) return;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.clientWidth, c.clientHeight);
      img.src = prev;
    });
    ro.observe(c);
    return () => ro.disconnect();
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
    if (drew.current) {
      const url = e.currentTarget.toDataURL("image/png");
      snapshot.current = url;
      setDataUrl(url);
    }
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
    snapshot.current = "";
    setDataUrl("");
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">Draw your signature</span>
        <button type="button" onClick={clear} className="text-xs text-stone-500 underline">Clear</button>
      </div>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="mt-1 h-32 w-full touch-none rounded-lg border border-stone-300 bg-white" aria-label="Signature pad" />
      {named ? <input type="hidden" name="signatureImage" value={dataUrl} /> : null}
    </div>
  );
}
