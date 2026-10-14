"use client";
import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { Minus, Plus, ScanBarcode, Volume2, VolumeX, X } from "lucide-react";
import { addScan, countDifference, matchProduct, orderProgress, setQty, totalUnits, type OrderLineInfo, type ScanLine } from "@/lib/scan";
import { attachBarcodeAction, countScannedAction, receiveOrderScannedAction, receiveScannedAction, type ScanResult } from "./actions";
import { cn } from "@/lib/utils";

export type ScanItem = { id: string; label: string; barcode: string | null; sku: string | null; category: string | null; onHand: number; tracked: boolean };
type Mode = "receive" | "count" | "order";
type Order = { id: string; number: number; supplier: string | null; reference: string; lines: OrderLineInfo[] };

/** Short sounds so you can tell a scan registered without looking at the screen (a scanner usually points away from it). */
function useBeeps() {
  const ctx = useRef<AudioContext | null>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("scan-sound") === "off") setOn(false);
    } catch {}
  }, []);
  const toggle = () => {
    setOn((v) => {
      try {
        localStorage.setItem("scan-sound", v ? "off" : "on");
      } catch {}
      return !v;
    });
  };
  const play = (ok: boolean) => {
    if (!on) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx.current ??= new Ctx();
      const c = ctx.current;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = ok ? 880 : 220;
      o.type = ok ? "sine" : "square";
      g.gain.value = 0.08;
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + (ok ? 0.08 : 0.25));
    } catch {}
  };
  return { on, toggle, play };
}

type State = { lines: ScanLine[]; last: string | null };
type Act = { t: "scan"; id: string } | { t: "qty"; id: string; qty: number } | { t: "remove"; id: string } | { t: "clear" };
const reduce = (s: State, a: Act): State => {
  if (a.t === "scan") return { lines: addScan(s.lines, a.id), last: a.id };
  if (a.t === "qty") return { lines: setQty(s.lines, a.id, a.qty), last: s.last };
  if (a.t === "remove") return { lines: setQty(s.lines, a.id, 0), last: s.last };
  return { lines: [], last: null };
};

/**
 * One scanning screen for three jobs: a delivery with no order ("receive"), a delivery checked against an order ("order"), and a count ("count").
 * The box at the top keeps the focus, so you only point the scanner and pull the trigger. A code the app doesn't know asks which product it is
 * and remembers it. Nothing is saved until you press the button at the bottom.
 */
export function ScanSession({ slug, mode, products: initial, locations, defaultLocationId, order, book, trackedCount }: { slug: string; mode: Mode; products: ScanItem[]; locations: { id: string; name: string }[]; defaultLocationId: string; order?: Order; book?: Record<string, Record<string, number>>; trackedCount?: number }) {
  // Barcodes taught during this session count straight away (the list from the server is from when the page opened).
  const [learned, setLearned] = useState<Record<string, string>>({});
  const products = useMemo(() => initial.map((p) => (learned[p.id] ? { ...p, barcode: learned[p.id]! } : p)), [initial, learned]);
  const [s, dispatch] = useReducer(reduce, { lines: [], last: null });
  const [loc, setLoc] = useState(defaultLocationId);
  const [note, setNote] = useState(order?.reference ?? "");
  const [zeroRest, setZeroRest] = useState(false);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [tried, setTried] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const beeps = useBeeps();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const progress = useMemo(() => (order ? orderProgress(order.lines, s.lines) : null), [order, s.lines]);

  const focusBox = () => box.current?.focus();
  const scan = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setStatus(null);
    const p = matchProduct(products, code);
    if (!p) {
      beeps.play(false);
      setUnknown(code);
      setPick("");
      setAttachErr(null);
      return;
    }
    beeps.play(true);
    dispatch({ t: "scan", id: p.id });
  };

  const done = (r: ScanResult) => {
    setStatus({ ok: r.ok, text: r.ok ? r.message : r.error });
    if (r.ok) {
      dispatch({ t: "clear" });
      setZeroRest(false);
    }
    focusBox();
  };
  const submit = () => {
    if (!s.lines.length && !(mode === "count" && zeroRest)) return;
    start(async () => {
      if (mode === "receive") done(await receiveScannedAction({ slug, locationId: loc, note, lines: s.lines }));
      else if (mode === "count") done(await countScannedAction({ slug, locationId: loc, note, zeroRest, counts: s.lines.map((l) => ({ productId: l.productId, counted: l.qty })) }));
      else if (order && progress) {
        const mine = progress.lines.filter((l) => l.now > 0).map((l) => ({ lineId: l.lineId, qty: l.now }));
        if (!mine.length) return setStatus({ ok: false, text: "None of what you scanned is on this order." });
        done(await receiveOrderScannedAction({ slug, orderId: order.id, reference: note, lines: mine }));
      }
    });
  };
  const attach = (productId: string, replace = false) => {
    if (!unknown) return;
    setTried(productId);
    start(async () => {
      const r = await attachBarcodeAction({ slug, productId, code: unknown, replace });
      if (!r.ok) return setAttachErr(r.error);
      beeps.play(true);
      setLearned((cur) => ({ ...cur, [productId]: unknown }));
      dispatch({ t: "scan", id: productId });
      setStatus({ ok: true, text: r.message });
      setUnknown(null);
      focusBox();
    });
  };

  const candidates = useMemo(() => {
    const n = pick.trim().toLowerCase();
    return (n ? products.filter((p) => `${p.label} ${p.category ?? ""}`.toLowerCase().includes(n)) : products).slice(0, 6);
  }, [pick, products]);
  const units = totalUnits(order && progress ? s.lines.filter((l) => order.lines.some((o) => o.productId === l.productId)) : s.lines);
  const bookQty = (id: string) => book?.[loc]?.[id] ?? 0;
  const verb = mode === "count" ? "Apply count" : mode === "order" ? "Receive these" : "Add to stock";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-stone-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-600" aria-hidden />
            <input
              ref={box}
              autoFocus
              autoComplete="off"
              enterKeyHint="go"
              aria-label="Scan a barcode"
              placeholder="Scan a barcode"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                scan(e.currentTarget.value);
                e.currentTarget.value = "";
              }}
              onBlur={() => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) focusBox(); }, 50)}
              className="h-12 w-full rounded-xl border-2 border-brand-300 bg-white pl-10 pr-3 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>
          <button type="button" onClick={beeps.toggle} aria-pressed={beeps.on} aria-label={beeps.on ? "Mute scan sounds" : "Turn scan sounds on"} className="rounded-lg border border-stone-300 bg-white p-3 text-stone-600">
            {beeps.on ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        </div>
        {mode !== "order" && locations.length > 1 ? (
          <select value={loc} onChange={(e) => { setLoc(e.target.value); focusBox(); }} aria-label="Where" className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm sm:w-auto">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className={cn("rounded-lg px-3 py-2 text-sm", status ? (status.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800") : "sr-only")}>{status?.text}</p>

      {unknown ? (
        <div role="alertdialog" aria-label="Unknown barcode" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-amber-950">The app doesn't know <b className="font-mono">{unknown}</b> yet. Which product is it? It will be remembered.</p>
            <button type="button" onClick={() => { setUnknown(null); focusBox(); }} aria-label="Skip this scan" className="rounded p-1 text-amber-900 hover:bg-amber-100"><X className="h-4 w-4" /></button>
          </div>
          <input autoFocus value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Find the product" aria-label="Find the product this barcode belongs to" className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm" />
          <ul className="divide-y divide-amber-100 overflow-hidden rounded-lg border border-amber-200 bg-white">
            {candidates.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={busy} onClick={() => attach(p.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-stone-50">
                  <span className="min-w-0 truncate">{p.label}</span>
                  <span className="shrink-0 text-xs text-stone-500">{p.barcode ? `has ${p.barcode}` : p.category ?? ""}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 ? <li className="px-3 py-2.5 text-sm text-stone-500">No product matches.</li> : null}
          </ul>
          {attachErr ? (
            <p className="text-sm text-red-700">
              {attachErr}
              {/already has the barcode/.test(attachErr) ? <> <button type="button" className="underline" onClick={() => { if (tried) attach(tried, true); }}>Replace it</button></> : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {s.lines.length === 0 && !status?.ok ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          {mode === "count" ? "Scan each item on the shelf. Scan the same product again for each unit." : mode === "order" ? "Scan the items in the delivery. They're checked off against the order as you go." : "Scan each item in the delivery. Scan the same product again for each unit, or type the number."}
        </div>
      ) : null}

      {progress && order ? (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {progress.lines.map((l) => {
            const p = byId.get(l.productId);
            const tone = l.status === "complete" ? "text-emerald-700" : l.status === "over" ? "text-red-700" : l.status === "short" ? "text-amber-700" : "text-stone-400";
            return (
              <li key={l.lineId} className={cn("flex items-center gap-3 px-3 py-3 text-sm transition-colors", s.last === l.productId && "bg-brand-50")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p?.label ?? "Product"}</p>
                  <p className={cn("text-xs", tone)}>
                    {l.status === "over" ? `${l.before + l.now - l.ordered} too many` : l.status === "complete" ? "All here" : l.status === "waiting" ? `${l.remaining} to come` : `${l.remaining} still to come`}
                    {l.before ? ` · ${l.before} came earlier` : ""}
                  </p>
                </div>
                <Stepper value={l.now} onChange={(q) => dispatch({ t: "qty", id: l.productId, qty: q })} label={p?.label ?? "product"} />
                <span className="w-16 shrink-0 text-right text-xs text-stone-500">of {l.ordered}</span>
              </li>
            );
          })}
        </ul>
      ) : s.lines.length ? (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {s.lines.map((l) => {
            const p = byId.get(l.productId);
            const diff = mode === "count" ? countDifference(l.qty, bookQty(l.productId)) : 0;
            return (
              <li key={l.productId} className={cn("flex items-center gap-3 px-3 py-3 text-sm transition-colors", s.last === l.productId && "bg-brand-50")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p?.label ?? "Product"}</p>
                  <p className="text-xs text-stone-500">
                    {mode === "count" ? <>book says {bookQty(l.productId)}{diff !== 0 ? <span className={cn("ml-1.5 font-medium", diff < 0 ? "text-red-700" : "text-amber-700")}>{diff > 0 ? "+" : "−"}{Math.abs(diff)}</span> : <span className="ml-1.5 text-emerald-700">matches</span>}</> : `${p?.onHand ?? 0} on hand now`}
                  </p>
                </div>
                <Stepper value={l.qty} onChange={(q) => dispatch({ t: "qty", id: l.productId, qty: q })} label={p?.label ?? "product"} />
                <button type="button" onClick={() => dispatch({ t: "remove", id: l.productId })} aria-label={`Remove ${p?.label ?? "product"}`} className="rounded p-1.5 text-stone-400 hover:text-red-600"><X className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {progress && progress.notOnOrder.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium">Not on this order (these won't be received):</p>
          <ul className="mt-1 space-y-1">
            {progress.notOnOrder.map((l) => (
              <li key={l.productId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{byId.get(l.productId)?.label ?? "Product"} × {l.qty}</span>
                <button type="button" onClick={() => dispatch({ t: "remove", id: l.productId })} className="text-xs underline">Remove</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode === "count" ? (
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={zeroRest} onChange={(e) => setZeroRest(e.target.checked)} className="mt-1 h-4 w-4" />
          <span>Anything I didn't scan is none<span className="block text-xs text-stone-500">Use for a full count of this location: the {trackedCount ?? 0} tracked products you didn't scan are set to 0. Otherwise they're left alone.</span></span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "count" ? "Note (optional)" : mode === "order" ? "Invoice or delivery number" : "Invoice number, note"} aria-label="Note" className="h-11 min-w-[12rem] flex-1 rounded-lg border border-stone-300 bg-white px-3 text-sm" />
        <button type="button" onClick={submit} disabled={busy || (!s.lines.length && !(mode === "count" && zeroRest))} className="h-11 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : `${verb}${units ? ` (${units})` : ""}`}
        </button>
        {s.lines.length ? <button type="button" onClick={() => { dispatch({ t: "clear" }); setStatus(null); focusBox(); }} className="h-11 rounded-lg px-3 text-sm text-stone-600 underline">Start over</button> : null}
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (q: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(value - 1)} aria-label={`One fewer ${label}`} className="rounded-lg border border-stone-300 p-2 text-stone-600"><Minus className="h-4 w-4" /></button>
      <input value={value} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")))} inputMode="numeric" aria-label={`Quantity of ${label}`} className="h-9 w-12 rounded-lg border border-stone-300 text-center text-sm tabular-nums" />
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`One more ${label}`} className="rounded-lg border border-stone-300 p-2 text-stone-600"><Plus className="h-4 w-4" /></button>
    </div>
  );
}

