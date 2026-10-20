"use client";
import { useActionState, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setInputFiles, useFileDrop } from "@/lib/use-file-drop";

export type PhotoState = { error?: string } | undefined;

/**
 * The "add photos" tile. Tap it, take or choose one or more photos (or drop them on it), and they upload straight away: there is no
 * separate Save step. Used for before and after photos on a visit.
 */
export function PhotoAdd({ action, fields, label }: { action: (prev: PhotoState, fd: FormData) => Promise<PhotoState>; fields: Record<string, string>; label: string }) {
  const [state, act, pending] = useActionState(action, undefined);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Dropped photos take the same path as chosen ones: into the input, then the form submits and uploads them.
  const { dragging, handlers } = useFileDrop((files) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length || !setInputFiles(input.current, images)) return;
    form.current?.requestSubmit();
    if (input.current) input.current.value = "";
  }, { disabled: pending });
  return (
    <form ref={form} action={act} className="shrink-0">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input
        ref={input}
        type="file"
        name="files"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={() => {
          if (!input.current?.files?.length) return;
          form.current?.requestSubmit();
          input.current.value = ""; // the form data was captured by the submit; clear it so the same photo can be added again
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        aria-label={label}
        {...handlers}
        className={cn("flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 bg-stone-50 text-xs text-stone-500 transition hover:border-brand-400 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-70", dragging && "border-solid border-brand-500 bg-brand-50 ring-2 ring-brand-200")}
      >
        {pending ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Uploading</> : <><Camera className="h-5 w-5" aria-hidden /> Add</>}
      </button>
      {state?.error ? <p role="alert" className="mt-1 w-24 text-xs leading-4 text-red-700">{state.error}</p> : null}
    </form>
  );
}
