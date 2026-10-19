"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ConfirmSubmit } from "@/components/form";
import type { PhotoRow } from "@/lib/visit-photos";
import { removePhoto } from "./photo-actions";

const src = (id: string) => `/api/files/${id}`;

/**
 * The pictures a client attached when booking online, on the appointment's Photos card: a strip of thumbnails that open in a lightbox
 * (arrows or thumbnails to move between them), each with an (x) to remove it. Nothing can be added here: these are the client's.
 */
export function ClientPhotos({ slug, appointmentId, photos }: { slug: string; appointmentId: string; photos: PhotoRow[] }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const cur = photos[Math.min(i, photos.length - 1)];
  const show = (n: number) => { setI(n); setOpen(true); dlg.current?.showModal(); };
  const step = (d: number) => setI((n) => (n + d + photos.length) % photos.length);
  if (!photos.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">From the client</p>
      <p className="mb-2 text-xs text-stone-500">Sent with the online booking: inspiration, a reference, or how things look now.</p>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, n) => (
          <li key={p.id} className="relative">
            <button type="button" onClick={() => show(n)} aria-label={`Open photo ${n + 1} from the client`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-brand-500">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(p.thumbFileId ?? p.fileId)} alt={`Photo ${n + 1} from the client`} loading="lazy" className="h-24 w-24 rounded-lg bg-stone-100 object-cover" />
            </button>
            <form action={removePhoto} className="absolute -right-2 -top-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="appointmentId" value={appointmentId} />
              <input type="hidden" name="photoId" value={p.id} />
              <ConfirmSubmit title="Remove this photo?" body="The client's picture is deleted for good." confirmLabel="Remove" variant="ghost" className="!h-6 !w-6 !rounded-full !border !border-stone-200 !bg-white !p-0 text-stone-600 shadow-sm hover:!border-red-300 hover:!bg-red-50 hover:text-red-700">
                <X className="h-3.5 w-3.5" aria-label="Remove photo" />
              </ConfirmSubmit>
            </form>
          </li>
        ))}
      </ul>
      <dialog
        ref={dlg}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}
        onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); }}
        className="m-auto w-[min(96vw,56rem)] rounded-2xl border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-black/60"
      >
        {open && cur ? (
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-stone-900">From the client</p>
                <p className="text-sm text-stone-600">Photo {i + 1} of {photos.length}</p>
              </div>
              <button type="button" onClick={() => dlg.current?.close()} aria-label="Close" className="rounded-full p-2.5 text-stone-500 hover:bg-stone-100"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(cur.fileId)} alt={`Photo ${i + 1} from the client`} className="max-h-[70vh] w-full rounded-lg bg-stone-100 object-contain" />
              {photos.length > 1 ? (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow hover:bg-white"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
                  <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow hover:bg-white"><ChevronRight className="h-5 w-5" aria-hidden /></button>
                </>
              ) : null}
            </div>
            {photos.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {photos.map((p, n) => (
                  <button key={p.id} type="button" onClick={() => setI(n)} aria-label={`Photo ${n + 1}`} className={`h-12 w-12 overflow-hidden rounded-md ring-offset-1 ${n === i ? "ring-2 ring-brand-500" : "opacity-70 hover:opacity-100"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src(p.thumbFileId ?? p.fileId)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
