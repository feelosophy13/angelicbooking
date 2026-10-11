"use client";
import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One way to add, change or remove a picture: the picture itself is the
 * control. Click (or press Enter on) the image area to pick a file; the new
 * file previews in place; Remove clears it. Everything posts with the
 * surrounding form: the file under `name`, and `removeName`="on" when the
 * current picture should go. Nothing is saved until the form is.
 */
export function ImageField({ name, removeName, current, shape = "square", placeholder, placeholderColor, className }: {
  name: string;
  /** Hidden field set to "on" when the current picture is removed (omit for create forms). */
  removeName?: string;
  current: string | null;
  shape?: "square" | "round" | "wide";
  /** Text shown in the empty state, e.g. the person's initial. */
  placeholder?: string;
  placeholderColor?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const shown = preview ?? (removed ? null : current);
  const box = shape === "round" ? "h-24 w-24 rounded-full" : shape === "wide" ? "h-28 w-48 rounded-xl" : "h-28 w-28 rounded-xl";

  function pick(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    if (!file) {
      setPreview(null);
      setFileName(null);
      return;
    }
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
    setRemoved(false);
  }
  function remove() {
    if (preview) {
      pick(null);
      if (input.current) input.current.value = "";
      return;
    }
    setRemoved(true);
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      <input ref={input} type="file" name={name} accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      {removeName ? <input type="hidden" name={removeName} value={removed ? "on" : ""} /> : null}
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn("group relative shrink-0 overflow-hidden border-2 border-dashed border-stone-300 bg-stone-50 text-stone-500 transition hover:border-brand-400 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500", box, shown && "border-solid border-stone-200")}
        aria-label={shown ? "Change picture" : "Add picture"}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : placeholder ? (
          <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white" style={{ background: placeholderColor ?? "#a8a29e" }}>{placeholder}</span>
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs">
            <Camera className="h-5 w-5" aria-hidden />
            Add photo
          </span>
        )}
        <span className={cn("absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100", !shown && placeholder && "opacity-100 bg-black/35")}>{shown ? "Change" : "Add photo"}</span>
      </button>
      <div className="space-y-1 text-xs text-stone-500">
        {fileName ? <p className="text-stone-800">{fileName} <span className="text-stone-500">· saved when you save the form</span></p> : removed ? <p className="text-stone-800">Picture will be removed when you save. <button type="button" onClick={() => setRemoved(false)} className="text-brand-700 underline">Undo</button></p> : <p>{shown ? "Click the picture to change it." : "Click to choose a picture."}</p>}
        <p>PNG, JPEG or WebP up to 2 MB.</p>
        {shown ? <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-stone-600 hover:text-red-600"><X className="h-3.5 w-3.5" /> Remove</button> : null}
      </div>
    </div>
  );
}
