"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PairPhoto = { id: string; fileId: string; thumbFileId: string | null };
export type PairView = {
  key: string;
  appointmentHref: string;
  clientName: string | null;
  clientHref: string | null;
  serviceName: string | null;
  staffName: string | null;
  dateLabel: string;
  tags: string[];
  shareOk: boolean;
  before: PairPhoto[];
  after: PairPhoto[];
};

const src = (id: string) => `/api/files/${id}`;

function Half({ photos, label }: { photos: PairPhoto[]; label: string }) {
  const first = photos[0];
  return (
    <div className="relative aspect-square bg-stone-50">
      {first ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src(first.thumbFileId ?? first.fileId)} alt={`${label} photo`} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-stone-400">No {label.toLowerCase()} yet</span>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">{label}</span>
      {photos.length > 1 ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">+{photos.length - 1}</span> : null}
    </div>
  );
}

function Column({ label, photos }: { label: string; photos: PairPhoto[] }) {
  const [i, setI] = useState(0);
  const cur = photos[Math.min(i, photos.length - 1)];
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      {cur ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(cur.fileId)} alt={`${label} photo`} loading="lazy" className="max-h-[65vh] w-full rounded-lg bg-stone-100 object-contain" />
          {photos.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {photos.map((p, n) => (
                <button key={p.id} type="button" onClick={() => setI(n)} aria-label={`${label} photo ${n + 1}`} className={cn("h-12 w-12 overflow-hidden rounded-md ring-offset-1", n === i ? "ring-2 ring-brand-500" : "opacity-70 hover:opacity-100")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(p.thumbFileId ?? p.fileId)} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-400">No {label.toLowerCase()} photo yet</div>
      )}
    </div>
  );
}

/** A before/after pair as a card; clicking it opens both photos large. */
export function PairCard({ pair }: { pair: PairView }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const title = [pair.serviceName ?? "Service", pair.staffName].filter(Boolean).join(" · ");
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); dlg.current?.showModal(); }}
        className="block w-full overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-sm transition hover:border-brand-300 hover:shadow focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <div className="grid grid-cols-2 gap-px bg-stone-200">
          <Half photos={pair.before} label="Before" />
          <Half photos={pair.after} label="After" />
        </div>
        <div className="space-y-0.5 p-2.5">
          <p className="truncate text-sm font-medium text-stone-900">{title}</p>
          <p className="truncate text-xs text-stone-500">{[pair.clientName, pair.dateLabel].filter(Boolean).join(" · ")}</p>
          {pair.tags.length ? <p className="line-clamp-1 text-xs text-brand-700">{pair.tags.map((t) => `#${t}`).join(" ")}</p> : null}
        </div>
      </button>
      <dialog
        ref={dlg}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}
        className="m-auto w-[min(96vw,64rem)] rounded-2xl border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-black/60"
      >
        {open ? (
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-stone-900">{title}</p>
                <p className="text-sm text-stone-600">
                  {pair.clientName ? (pair.clientHref ? <Link href={pair.clientHref} className="underline">{pair.clientName}</Link> : pair.clientName) : "Walk-in"} · {pair.dateLabel}
                  {pair.shareOk ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">OK to share</span> : null}
                </p>
                {pair.tags.length ? <p className="mt-0.5 text-sm text-brand-700">{pair.tags.map((t) => `#${t}`).join(" ")}</p> : null}
              </div>
              <button type="button" onClick={() => dlg.current?.close()} aria-label="Close" className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Column label="Before" photos={pair.before} />
              <Column label="After" photos={pair.after} />
            </div>
            <p className="mt-4 text-sm"><Link href={pair.appointmentHref} className="text-brand-700 underline">Open the appointment</Link></p>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
