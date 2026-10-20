"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { MAX_BOOKING_PHOTOS, PHOTOS_FIELD } from "@/lib/booking-photos";
import { useFileDrop } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

type Picked = { key: string; file: File; url: string };

/** Longest side a picture is shrunk to in the browser before upload; the server resizes again, this just spares the client's data plan. */
const MAX_SIDE = 2000;
/** Below this a picture goes up as it is (already small); above it the browser re-encodes it as a JPEG when it can read it. */
const SHRINK_FROM = 1_200_000;
/** The most one picture may be after shrinking. Five of these stay well inside what the server accepts in one request. */
const MAX_BYTES = 10 * 1024 * 1024;

const isHeic = (f: File) => /image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name);
const looksLikePicture = (f: File) => f.type.startsWith("image/") || isHeic(f);

/** Draw the picture into a canvas (the browser applies the camera's orientation) and hand back a JPEG; null when it cannot be read here. */
async function shrink(file: File): Promise<File | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => no(new Error("unreadable"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!blob) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Add photos" on the booking form: inspiration pictures, a reference style, a photo of the client's current lashes or brows. Optional,
 * up to MAX_BOOKING_PHOTOS. Tapping the tile opens the camera roll (or the camera) with multiple selection; each picture previews with an
 * (x) to take it out again before booking. The chosen files travel with the surrounding form under the `photos` name, so the free and
 * the paid booking forms both get them without any extra wiring; large ones are shrunk in the browser first when it can read them.
 */
export function PhotoPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const hintId = useId();

  // The hidden input is what the form posts, so it mirrors the list (including removals). A browser that cannot set `files` keeps its own selection.
  const sync = (list: Picked[]) => {
    const el = input.current;
    if (!el) return;
    try {
      const dt = new DataTransfer();
      for (const p of list) dt.items.add(p.file);
      el.files = dt.files;
    } catch {
      /* older browser */
    }
  };
  useEffect(() => sync(picked), [picked]);
  const latest = useRef(picked);
  latest.current = picked;
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function add(list: File[]) {
    if (!list.length) return;
    const room = MAX_BOOKING_PHOTOS - picked.length;
    const problems: string[] = [];
    if (list.length > room) problems.push(room <= 0 ? `You can attach up to ${MAX_BOOKING_PHOTOS} photos.` : `Only ${room} more photo${room === 1 ? "" : "s"} can be added (up to ${MAX_BOOKING_PHOTOS}).`);
    setBusy((n) => n + 1);
    const ready: Picked[] = [];
    for (const f of list.slice(0, Math.max(0, room))) {
      if (!looksLikePicture(f)) { problems.push(`${f.name} isn't a picture.`); continue; }
      let use = f;
      if (f.size > SHRINK_FROM || isHeic(f)) use = (await shrink(f)) ?? f; // unreadable here (e.g. HEIC off an iPhone on Android): the server has one more go
      if (use.size > MAX_BYTES) { problems.push(`${f.name} is too large (over 10 MB).`); continue; }
      ready.push({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file: use, url: URL.createObjectURL(use) });
    }
    setPicked((cur) => [...cur, ...ready].slice(0, MAX_BOOKING_PHOTOS));
    setErrors(problems);
    setBusy((n) => n - 1);
  }

  const remove = (key: string) => setPicked((cur) => { cur.find((p) => p.key === key)?.url && URL.revokeObjectURL(cur.find((p) => p.key === key)!.url); return cur.filter((p) => p.key !== key); });
  const full = picked.length >= MAX_BOOKING_PHOTOS;
  // Dropping pictures anywhere on the photo strip adds them, through the same checks as choosing them.
  const { dragging, handlers } = useFileDrop((files) => void add(files), { disabled: busy > 0 });

  return (
    <div>
      <p className="mb-1 block text-sm font-medium text-stone-700">Photos <span className="font-normal text-stone-400">(optional)</span></p>
      <p id={hintId} className="mb-2 text-xs text-stone-500">Inspiration, a style you like, or how your lashes or brows look now. Up to {MAX_BOOKING_PHOTOS}; only your provider sees them.</p>
      <input
        ref={input}
        type="file"
        name={PHOTOS_FIELD}
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          // Copy the selection out, put the list back (so a rejected file never rides along), then check and add the copies.
          const copy = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          sync(picked);
          void add(copy);
        }}
      />
      <ul {...handlers} className={cn("-m-1 flex flex-wrap gap-2 rounded-2xl p-1 transition", dragging && "bg-white ring-2 ring-[var(--brand)]")} aria-label="Photos to send with your booking">
        {picked.map((p, i) => (
          <li key={p.key} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-xl border border-stone-200 bg-stone-100 object-cover" />
            <button type="button" onClick={() => remove(p.key)} aria-label={`Remove photo ${i + 1}`} className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"><X className="h-3.5 w-3.5" aria-hidden /></span>
            </button>
          </li>
        ))}
        {!full ? (
          <li>
            <button
              type="button"
              disabled={busy > 0}
              onClick={() => input.current?.click()}
              aria-describedby={hintId}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 text-xs text-stone-500 transition hover:border-[var(--brand)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-70"
            >
              {busy > 0 ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Preparing</> : <><Camera className="h-5 w-5" aria-hidden /> {picked.length ? "Add more" : "Add photos"}</>}
            </button>
          </li>
        ) : null}
      </ul>
      {errors.length ? <ul role="alert" className="mt-2 space-y-0.5 text-xs text-red-700">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
    </div>
  );
}
