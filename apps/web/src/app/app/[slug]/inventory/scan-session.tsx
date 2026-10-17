"use client";
import { useMemo, useReducer, useRef, useState, useTransition } from "react";
import { Camera, Minus, Plus, ScanBarcode, Volume2, VolumeX, X } from "lucide-react";
import { addScan, countDifference, matchScan, orderProgress, setQty, totalUnits, type OrderLineInfo, type ScanLine } from "@/lib/scan";
import { attachBarcodeAction, countScannedAction, createProductFromScanAction, createOptionFromScanAction, receiveOrderScannedAction, receiveScannedAction, type CreatedProduct, type ScanResult } from "./actions";
import { CameraScanner } from "@/components/camera-scanner";
import { useBeeps } from "@/components/use-beeps";
import { cn } from "@/lib/utils";

export type ScanItem = { id: string; label: string; barcode: string | null; sku: string | null; category: string | null; onHand: number; tracked: boolean; codes: { code: string; units: number }[]; groupId?: string | null; groupName?: string | null };
type Mode = "receive" | "count" | "order";
type Order = { id: string; number: number; supplier: string | null; reference: string; lines: OrderLineInfo[] };

type State = { lines: ScanLine[]; last: string | null };
type Act = { t: "scan"; id: string; by?: number } | { t: "qty"; id: string; qty: number } | { t: "remove"; id: string } | { t: "clear" };
const reduce = (s: State, a: Act): State => {
  if (a.t === "scan") return { lines: addScan(s.lines, a.id, a.by ?? 1), last: a.id };
  if (a.t === "qty") return { lines: setQty(s.lines, a.id, a.qty), last: s.last };
  if (a.t === "remove") return { lines: setQty(s.lines, a.id, 0), last: s.last };
  return { lines: [], last: null };
};

/**
 * One scanning screen for three jobs: a delivery with no order ("receive"), a delivery checked against an order ("order"), and a count ("count").
 * A hand scanner types into the box at the top (it keeps the focus), or open the camera on a phone. A code the app doesn't know asks whether it is
 * an existing product (and remembers it, as the main barcode or another one for a case) or a new product (and creates it). Nothing is saved
 * until you press the button at the bottom.
 */
export function ScanSession({ slug, mode, products: initial, categories = [], locations, defaultLocationId, order, book, trackedCount }: { slug: string; mode: Mode; products: ScanItem[]; categories?: { id: string; name: string }[]; locations: { id: string; name: string }[]; defaultLocationId: string; order?: Order; book?: Record<string, Record<string, number>>; trackedCount?: number }) {
  // Things taught or created during this session count straight away (the list from the server is from when the page opened).
  const [learned, setLearned] = useState<Record<string, { barcode?: string; codes?: { code: string; units: number }[] }>>({});
  const [created, setCreated] = useState<ScanItem[]>([]);
  const products = useMemo<ScanItem[]>(
    () => [...initial.map((p) => (learned[p.id] ? { ...p, barcode: learned[p.id]!.barcode ?? p.barcode, codes: learned[p.id]!.codes ?? p.codes } : p)), ...created],
    [initial, learned, created],
  );
  const [s, dispatch] = useReducer(reduce, { lines: [], last: null });
  const [loc, setLoc] = useState(defaultLocationId);
  // When scanning began: sales made meanwhile are kept on top of the count.
  const [startedAt] = useState(() => new Date().toISOString());
  const [note, setNote] = useState(order?.reference ?? "");
  const [zeroRest, setZeroRest] = useState(false);
  const [camera, setCamera] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [tab, setTab] = useState<"existing" | "new" | "option">("existing");
  const [optionOf, setOptionOf] = useState<{ id: string; name: string } | null>(null);
  const [optForm, setOptForm] = useState({ label: "", price: "", cost: "" });
  const [pick, setPick] = useState("");
  const [chosen, setChosen] = useState<ScanItem | null>(null);
  const [packUnits, setPackUnits] = useState("1");
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", kind: "retail" as "retail" | "backbar", price: "", cost: "", categoryId: "" });
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
    const hit = matchScan(products, code);
    if (!hit) {
      beeps.play(false);
      setUnknown(code);
      setTab("existing");
      setPick("");
      setChosen(null);
      setProblem(null);
      setPackUnits("1");
      setForm({ name: "", kind: "retail", price: "", cost: "", categoryId: "" });
      setOptionOf(null);
      setOptForm({ label: "", price: "", cost: "" });
      return;
    }
    beeps.play(true);
    dispatch({ t: "scan", id: hit.product.id, by: hit.units });
  };
  const closeUnknown = () => {
    setUnknown(null);
    setChosen(null);
    focusBox();
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
      else if (mode === "count") done(await countScannedAction({ slug, locationId: loc, note, zeroRest, startedAt, counts: s.lines.map((l) => ({ productId: l.productId, counted: l.qty })) }));
      else if (order && progress) {
        const mine = progress.lines.filter((l) => l.now > 0).map((l) => ({ lineId: l.lineId, qty: l.now }));
        if (!mine.length) return setStatus({ ok: false, text: "None of what you scanned is on this order." });
        done(await receiveOrderScannedAction({ slug, orderId: order.id, reference: note, lines: mine }));
      }
    });
  };

  // Teach the app the scanned code: as the product's main barcode, in place of it, or as another one standing for a pack.
  const attach = (p: ScanItem, how: "set" | "replace" | "add") => {
    if (!unknown) return;
    const units = how === "add" ? Math.max(1, Math.floor(Number(packUnits) || 1)) : 1;
    start(async () => {
      const r = await attachBarcodeAction({ slug, productId: p.id, code: unknown, mode: how, units });
      if (!r.ok) return setProblem(r.error);
      beeps.play(true);
      setLearned((cur) => ({ ...cur, [p.id]: how === "add" ? { codes: [...(cur[p.id]?.codes ?? p.codes), { code: unknown, units }] } : { barcode: unknown } }));
      dispatch({ t: "scan", id: p.id, by: units });
      setStatus({ ok: true, text: r.message });
      closeUnknown();
    });
  };
  const choose = (p: ScanItem) => {
    setProblem(null);
    if (!p.barcode) return attach(p, "set");
    setChosen(p);
  };
  const createIt = () => {
    if (!unknown) return;
    start(async () => {
      const r = await createProductFromScanAction({ slug, code: unknown, ...form });
      if (!r.ok) return setProblem(r.error);
      const p: CreatedProduct = r.product;
      beeps.play(true);
      setCreated((cur) => [...cur, p]);
      dispatch({ t: "scan", id: p.id });
      setStatus({ ok: true, text: `${p.label} created and added` });
      closeUnknown();
    });
  };

  const groupChoices = useMemo(() => {
    const n = pick.trim().toLowerCase();
    const seen = new Map<string, { id: string; name: string; options: number }>();
    for (const p of products) if (p.groupId && p.groupName) seen.set(p.groupId, { id: p.groupId, name: p.groupName, options: (seen.get(p.groupId)?.options ?? 0) + 1 });
    return [...seen.values()].filter((g) => !n || g.name.toLowerCase().includes(n)).slice(0, 6);
  }, [pick, products]);
  const createOption = () => {
    if (!unknown || !optionOf) return;
    start(async () => {
      const r = await createOptionFromScanAction({ slug, code: unknown, groupId: optionOf.id, ...optForm });
      if (!r.ok) return setProblem(r.error);
      const p: CreatedProduct = r.product;
      beeps.play(true);
      setCreated((cur) => [...cur, { ...p, groupId: optionOf.id, groupName: optionOf.name }]);
      dispatch({ t: "scan", id: p.id });
      setStatus({ ok: true, text: `${p.label} created and added` });
      closeUnknown();
    });
  };

  const candidates = useMemo(() => {
    const n = pick.trim().toLowerCase();
    return (n ? products.filter((p) => `${p.label} ${p.category ?? ""}`.toLowerCase().includes(n)) : products).slice(0, 6);
  }, [pick, products]);
  const units = totalUnits(order && progress ? s.lines.filter((l) => order.lines.some((o) => o.productId === l.productId)) : s.lines);
  const bookQty = (id: string) => book?.[loc]?.[id] ?? 0;
  const verb = mode === "count" ? "Apply count" : mode === "order" ? "Receive these" : "Add to stock";
  const field = "h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm";

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
          <button type="button" onClick={() => setCamera((v) => !v)} aria-pressed={camera} aria-label={camera ? "Close the camera" : "Scan with the camera"} className={cn("rounded-lg border p-3", camera ? "border-brand-600 bg-brand-50 text-brand-700" : "border-stone-300 bg-white text-stone-600")}>
            <Camera className="h-5 w-5" />
          </button>
          <button type="button" onClick={beeps.toggle} aria-pressed={beeps.on} aria-label={beeps.on ? "Mute scan sounds" : "Turn scan sounds on"} className="rounded-lg border border-stone-300 bg-white p-3 text-stone-600">
            {beeps.on ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        </div>
        {camera ? <CameraScanner onScan={scan} onClose={() => { setCamera(false); focusBox(); }} /> : null}
        {mode !== "order" && locations.length > 1 ? (
          <select value={loc} onChange={(e) => { setLoc(e.target.value); focusBox(); }} aria-label="Where" className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm sm:w-auto">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className={cn("rounded-lg px-3 py-2 text-sm", status ? (status.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800") : "sr-only")}>{status?.text}</p>

      {unknown ? (
        <div role="alertdialog" aria-label="Unknown barcode" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-amber-950">The app doesn't know <b className="font-mono">{unknown}</b> yet.</p>
            <button type="button" onClick={closeUnknown} aria-label="Skip this scan" className="rounded p-1 text-amber-900 hover:bg-amber-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex gap-1 rounded-lg bg-amber-100 p-0.5 text-sm" role="tablist">
            {([["existing", "A product I have"], ["option", "A new size or shade"], ["new", "A new product"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setProblem(null); setPick(""); setOptionOf(null); }} className={cn("flex-1 rounded-md px-3 py-1.5", tab === k ? "bg-white font-medium shadow-sm" : "text-amber-900")}>{label}</button>
            ))}
          </div>

          {tab === "existing" && !chosen ? (
            <>
              <input autoFocus value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Find the product" aria-label="Find the product this barcode belongs to" className={field} />
              <ul className="divide-y divide-amber-100 overflow-hidden rounded-lg border border-amber-200 bg-white">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={busy} onClick={() => choose(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-stone-50">
                      <span className="min-w-0 truncate">{p.label}</span>
                      <span className="shrink-0 text-xs text-stone-500">{p.barcode ? "has a barcode" : p.category ?? ""}</span>
                    </button>
                  </li>
                ))}
                {candidates.length === 0 ? <li className="px-3 py-2.5 text-sm text-stone-500">No product matches. Try “It's a new product”.</li> : null}
              </ul>
            </>
          ) : null}

          {tab === "existing" && chosen ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-white p-3 text-sm">
              <p><b>{chosen.label}</b> already has the barcode <span className="font-mono">{chosen.barcode}</span>. What is this one?</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-stone-600">A case or pack of
                  <input value={packUnits} onChange={(e) => setPackUnits(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Units one scan stands for" className="h-9 w-16 rounded-lg border border-stone-300 px-2 text-right text-sm" />
                </label>
                <button type="button" disabled={busy} onClick={() => attach(chosen, "add")} className="h-9 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white disabled:opacity-60">Add as another barcode</button>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <button type="button" disabled={busy} onClick={() => attach(chosen, "replace")} className="underline">Replace the old barcode instead</button>
                <button type="button" onClick={() => { setChosen(null); setProblem(null); }} className="underline">Pick a different product</button>
              </div>
            </div>
          ) : null}

          {tab === "option" ? (
            <div className="space-y-2">
              {!optionOf ? (
                <>
                  <input autoFocus value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Which product is it a size or shade of?" aria-label="Find the product this is another option of" className={field} />
                  <ul className="divide-y divide-amber-100 overflow-hidden rounded-lg border border-amber-200 bg-white">
                    {groupChoices.map((g) => (
                      <li key={g.id}><button type="button" onClick={() => setOptionOf({ id: g.id, name: g.name })} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-stone-50"><span className="min-w-0 truncate">{g.name}</span><span className="shrink-0 text-xs text-stone-500">{g.options} option{g.options === 1 ? "" : "s"}</span></button></li>
                    ))}
                    {groupChoices.length === 0 ? <li className="px-3 py-2.5 text-sm text-stone-500">No product with options matches. For a product that doesn't have options yet, open it and choose "Comes in sizes or shades?".</li> : null}
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-sm">A new option of <b>{optionOf.name}</b></p>
                  <input autoFocus value={optForm.label} onChange={(e) => setOptForm({ ...optForm, label: e.target.value })} placeholder="What is it? A size or shade, e.g. 100 ml or 9N" aria-label="Name of the new option" className={field} />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={optForm.price} onChange={(e) => setOptForm({ ...optForm, price: e.target.value })} inputMode="decimal" placeholder="Price (blank: same as its first option)" aria-label="Price" className={field} />
                    <input value={optForm.cost} onChange={(e) => setOptForm({ ...optForm, cost: e.target.value })} inputMode="decimal" placeholder="Cost (optional)" aria-label="Cost per unit" className={field} />
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" disabled={busy || !optForm.label.trim()} onClick={createOption} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-60">Create and add this one</button>
                    <button type="button" onClick={() => { setOptionOf(null); setProblem(null); }} className="text-xs underline">Pick a different product</button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === "new" ? (
            <div className="space-y-2">
              <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Product name" aria-label="New product name" className={field} />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "retail" | "backbar" })} aria-label="What it is" className={field}>
                  <option value="retail">Sold to clients</option>
                  <option value="backbar">Used in services (back-bar)</option>
                </select>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} aria-label="Category" className={field}>
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {form.kind === "retail" ? <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="Price" aria-label="Price" className={field} /> : null}
                <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" placeholder="Cost (optional)" aria-label="Cost per unit" className={field} />
              </div>
              <button type="button" disabled={busy || !form.name.trim()} onClick={createIt} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white disabled:opacity-60">Create and add this one</button>
              <p className="text-xs text-amber-900">You can add a photo, description and the rest on the product's page later. It starts with no stock until you press the button below.</p>
            </div>
          ) : null}

          {problem ? <p role="alert" className="text-sm text-red-700">{problem}</p> : null}
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
