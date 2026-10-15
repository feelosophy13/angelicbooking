"use client";
import { useRef, useState } from "react";
import { X } from "lucide-react";

/** A stylist's work: small pictures that open large, so the client can see the style before choosing the person. */
export function WorkPhotos({ urls, name }: { urls: string[]; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!urls.length) return null;
  return (
    <>
      <div className="flex gap-2" aria-label={`Photos of ${name}'s work`}>
        {urls.map((u) => (
          <button key={u} type="button" onClick={() => { setOpen(u); dialog.current?.showModal(); }} className="h-14 w-14 overflow-hidden rounded-lg border border-stone-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]" aria-label={`Enlarge a photo of ${name}'s work`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      <dialog ref={dialog} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }} onClose={() => setOpen(null)} className="m-auto max-h-[90vh] max-w-[min(90vw,640px)] rounded-2xl bg-transparent p-0 backdrop:bg-black/60">
        <div className="relative">
          {open ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open} alt={`${name}'s work`} className="max-h-[90vh] w-full rounded-2xl object-contain" />
          ) : null}
          <button type="button" onClick={() => dialog.current?.close()} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
      </dialog>
    </>
  );
}
