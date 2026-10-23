"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Delete } from "lucide-react";
import { FormFill } from "@/components/form-fill";
import { KIOSK_DONE_MS, KIOSK_FORM_IDLE_MS, KIOSK_IDLE_MS } from "@/lib/checkin";
import type { KioskVisit } from "@/server/checkin-kiosk";
import { checkMeIn, findMyVisit, joinAsWalkIn, submitKioskForm } from "./actions";

type Screen =
  | { name: "welcome" }
  | { name: "phone"; full: boolean; note?: string }
  | { name: "none" }
  | { name: "pick"; people: KioskVisit[] }
  | { name: "visit"; visit: KioskVisit }
  | { name: "forms"; visit: KioskVisit; index: number }
  | { name: "done"; title: string; body: string }
  | { name: "walkin" };

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

const big = "flex h-16 w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-40";
const primary = `${big} text-white`;
const secondary = `${big} border border-stone-200 bg-white text-stone-800 active:bg-stone-100`;
const quiet = "hit mx-auto block py-3 text-lg text-stone-500 underline underline-offset-4";

/**
 * The check-in kiosk's screens. Everything resets to Welcome after a minute untouched (a few minutes on a form) and a few seconds
 * after a check-in, and the number typed is forgotten with it, so the next person never sees the last one's visit.
 */
export function Kiosk({ token }: { token: string }) {
  const [screen, setScreen] = useState<Screen>({ name: "welcome" });
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const touched = useRef(Date.now());

  const reset = useCallback(() => {
    setScreen({ name: "welcome" });
    setPhone("");
    setError(null);
  }, []);
  const go = (s: Screen) => {
    setError(null);
    setScreen(s);
  };

  // Idle reset: any touch or key counts as activity.
  useEffect(() => {
    const mark = () => (touched.current = Date.now());
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    const id = setInterval(() => {
      if (screen.name === "welcome" || screen.name === "done") return;
      if (Date.now() - touched.current > (screen.name === "forms" ? KIOSK_FORM_IDLE_MS : KIOSK_IDLE_MS)) reset();
    }, 5_000);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      clearInterval(id);
    };
  }, [screen.name, reset]);
  useEffect(() => {
    if (screen.name !== "done") return;
    const t = setTimeout(reset, KIOSK_DONE_MS);
    return () => clearTimeout(t);
  }, [screen, reset]);

  const lookup = () =>
    start(async () => {
      const r = await findMyVisit({ token, phone });
      if (!r.ok) return setError(r.error);
      const l = r.data;
      if (l.kind === "none") return go({ name: "none" });
      if (l.kind === "need_full") {
        setPhone("");
        return go({ name: "phone", full: true, note: "More than one client matches those digits. Please enter your full mobile number." });
      }
      if (l.people.length === 1) return go({ name: "visit", visit: l.people[0]! });
      go({ name: "pick", people: l.people });
    });

  const checkIn = (visit: KioskVisit, skipForms = false) =>
    start(async () => {
      const r = await checkMeIn({ token, phone, appointmentId: visit.appointmentId, skipForms });
      if (!r.ok) return setError(r.error);
      setPhone("");
      const first = r.data.name.split(" ")[0];
      go({
        name: "done",
        title: r.data.already ? `You're already checked in, ${first}` : `You're checked in, ${first}`,
        body: skipForms ? "We've let the team know you're here. The front desk will help you with your forms. Please take a seat." : "We've let the team know you're here. Please take a seat.",
      });
    });

  const Err = () => (error ? <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-lg text-red-700" role="alert">{error}</p> : null);

  if (screen.name === "welcome") {
    return (
      <Panel>
        <p className="mb-8 text-center text-3xl font-semibold text-stone-900">Welcome</p>
        <button type="button" className={primary} style={{ background: "var(--brand)" }} onClick={() => go({ name: "phone", full: false })}>Check in for my appointment</button>
        <button type="button" className={`${secondary} mt-4`} onClick={() => go({ name: "walkin" })}>I don&apos;t have an appointment</button>
      </Panel>
    );
  }

  if (screen.name === "phone") {
    const max = screen.full ? 11 : 4;
    const ready = screen.full ? phone.length >= 10 : phone.length === 4;
    const press = (k: string) => {
      setError(null);
      if (k === "del") return setPhone((p) => p.slice(0, -1));
      setPhone((p) => (p.length >= max ? p : p + k));
    };
    return (
      <Panel>
        <p className="mb-2 text-center text-2xl font-semibold text-stone-900">{screen.full ? "Your mobile number" : "Last 4 digits of your mobile"}</p>
        <p className="mb-5 text-center text-lg text-stone-600">{screen.note ?? "We'll find your appointment today."}</p>
        <Err />
        <div className="mb-4 flex h-16 items-center justify-center rounded-2xl border border-stone-200 bg-white text-3xl tabular-nums tracking-[0.3em] text-stone-900" aria-live="polite" aria-label="Number typed">
          {phone || <span className="text-xl tracking-normal text-stone-400">{screen.full ? "(555) 555-5555" : "• • • •"}</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} className="h-16 rounded-2xl border border-stone-200 bg-white text-3xl font-medium text-stone-800 active:bg-stone-100">{k}</button>
          ))}
          <button type="button" onClick={() => press("del")} className="flex h-16 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-600 active:bg-stone-100" aria-label="Delete"><Delete className="h-7 w-7" /></button>
          <button type="button" onClick={() => press("0")} className="h-16 rounded-2xl border border-stone-200 bg-white text-3xl font-medium text-stone-800 active:bg-stone-100">0</button>
          <button type="button" disabled={!ready || pending} onClick={lookup} className="h-16 rounded-2xl text-xl font-semibold text-white disabled:opacity-40" style={{ background: "var(--brand)" }}>{pending ? "…" : "Find"}</button>
        </div>
        <div className="mt-3 flex justify-center gap-8">
          {!screen.full ? <button type="button" className={`${quiet} mx-0`} onClick={() => { setPhone(""); go({ name: "phone", full: true }); }}>Type my whole number</button> : null}
          <button type="button" className={`${quiet} mx-0`} onClick={reset}>Cancel</button>
        </div>
      </Panel>
    );
  }

  if (screen.name === "none") {
    return (
      <Panel>
        <p className="mb-3 text-center text-2xl font-semibold text-stone-900">We couldn&apos;t find a visit today</p>
        <p className="mb-8 text-center text-lg text-stone-600">Check the number and try again, or see the front desk.</p>
        <button type="button" className={primary} style={{ background: "var(--brand)" }} onClick={() => { setPhone(""); go({ name: "phone", full: false }); }}>Try again</button>
        <button type="button" className={`${secondary} mt-4`} onClick={() => go({ name: "walkin" })}>I don&apos;t have an appointment</button>
        <button type="button" className={`${quiet} mt-4`} onClick={reset}>Start over</button>
      </Panel>
    );
  }

  if (screen.name === "pick") {
    return (
      <Panel>
        <p className="mb-6 text-center text-2xl font-semibold text-stone-900">Who is checking in?</p>
        <div className="space-y-3">
          {screen.people.map((p) => (
            <button key={p.appointmentId} type="button" className={secondary} onClick={() => go({ name: "visit", visit: p })}>{p.name}</button>
          ))}
        </div>
        <button type="button" className={`${quiet} mt-4`} onClick={reset}>None of these</button>
      </Panel>
    );
  }

  if (screen.name === "visit") {
    const v = screen.visit;
    const at = time(v.startAt, v.timeZone);
    return (
      <Panel>
        <p className="mb-1 text-center text-3xl font-semibold text-stone-900">Hi {v.name}</p>
        <div className="my-6 rounded-2xl border border-stone-200 bg-white p-5 text-center">
          <p className="text-2xl font-semibold tabular-nums text-stone-900">{at}</p>
          {v.services.map((s, i) => <p key={i} className="mt-1 text-lg text-stone-700">{s}</p>)}
        </div>
        <Err />
        {v.state === "ready" ? (
          v.formsDue.length ? (
            <>
              <p className="mb-4 text-center text-lg text-stone-600">{v.formsDue.length === 1 ? `Please fill in ${v.formsDue[0]!.name} first. It takes a minute or two.` : `Please fill in ${v.formsDue.length} short forms first.`}</p>
              <button type="button" className={primary} style={{ background: "var(--brand)" }} onClick={() => go({ name: "forms", visit: v, index: 0 })}>Fill in {v.formsDue.length === 1 ? "the form" : "the forms"}</button>
            </>
          ) : (
            <button type="button" disabled={pending} className={primary} style={{ background: "var(--brand)" }} onClick={() => checkIn(v)}>{pending ? "Checking in…" : "Check in"}</button>
          )
        ) : (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-lg text-amber-900">
            {v.state === "already" ? "You're already checked in. Please take a seat." : v.state === "early" ? `You're a little early for your ${at} appointment. Please see the front desk, or come back closer to your time.` : `It looks like your ${at} appointment has already ended. Please see the front desk.`}
          </p>
        )}
        <button type="button" className={`${quiet} mt-4`} onClick={reset}>{v.state === "ready" ? "That's not me" : "Done"}</button>
      </Panel>
    );
  }

  if (screen.name === "forms") {
    const v = screen.visit;
    const form = v.formsDue[screen.index]!;
    const last = screen.index === v.formsDue.length - 1;
    return (
      <div className="w-full max-w-2xl">
        <p className="mb-1 text-center text-sm text-stone-500">{v.formsDue.length > 1 ? `Form ${screen.index + 1} of ${v.formsDue.length}` : null}</p>
        <h2 className="mb-4 text-center text-2xl font-semibold text-stone-900">{form.name}</h2>
        <Err />
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-base sm:p-6">
          <FormFill
            key={form.id}
            action={submitKioskForm}
            hidden={{ token, phone, appointmentId: v.appointmentId, formId: form.id }}
            form={form}
            clientName={v.name}
            submitLabel={last ? (form.requireSignature ? "Sign and check in" : "Submit and check in") : form.requireSignature ? "Sign and continue" : "Continue"}
            onDone={() => (last ? checkIn(v) : go({ name: "forms", visit: v, index: screen.index + 1 }))}
          />
        </div>
        <button type="button" className={`${quiet} mt-4`} onClick={() => checkIn(v, true)}>Do this at the front desk instead</button>
        <button type="button" className={quiet} onClick={reset}>Cancel</button>
      </div>
    );
  }

  if (screen.name === "done") {
    return (
      <Panel>
        <CheckCircle2 className="mx-auto mb-4 h-20 w-20" style={{ color: "var(--brand)" }} aria-hidden />
        <p className="mb-3 text-center text-3xl font-semibold text-stone-900" role="status">{screen.title}</p>
        <p className="mb-8 text-center text-xl text-stone-600">{screen.body}</p>
        <button type="button" className={secondary} onClick={reset}>Done</button>
      </Panel>
    );
  }

  return <WalkIn token={token} onCancel={reset} onDone={(firstName) => go({ name: "done", title: `Thanks, ${firstName}`, body: "We've let the front desk know you're here. Someone will be with you shortly." })} />;
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md">{children}</div>;
}

/** "I don't have an appointment": name and number, onto today's Waitlist for the desk to book. */
function WalkIn({ token, onCancel, onDone }: { token: string; onCancel: () => void; onDone: (firstName: string) => void }) {
  const [v, setV] = useState({ firstName: "", lastName: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "h-16 w-full rounded-2xl border border-stone-300 bg-white px-4 text-xl text-stone-900 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-ring)]";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await joinAsWalkIn({ token, ...v });
      if (!r.ok) return setError(r.error);
      onDone(r.data.firstName);
    });
  };
  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-4">
      <p className="text-center text-2xl font-semibold text-stone-900">Welcome in</p>
      <p className="text-center text-lg text-stone-600">Leave your name and number and we&apos;ll fit you in if we can.</p>
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-lg text-red-700" role="alert">{error}</p> : null}
      <label className="block">
        <span className="mb-1 block text-base font-medium text-stone-700">First name</span>
        <input className={field} value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} autoComplete="off" autoCapitalize="words" required maxLength={60} />
      </label>
      <label className="block">
        <span className="mb-1 block text-base font-medium text-stone-700">Last name</span>
        <input className={field} value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} autoComplete="off" autoCapitalize="words" maxLength={60} />
      </label>
      <label className="block">
        <span className="mb-1 block text-base font-medium text-stone-700">Mobile number</span>
        <input className={field} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="off" required maxLength={20} />
      </label>
      <button type="submit" disabled={pending || !v.firstName.trim() || v.phone.replace(/\D/g, "").length < 10} className={primary} style={{ background: "var(--brand)" }}>{pending ? "Sending…" : "Let the front desk know"}</button>
      <button type="button" className={quiet} onClick={onCancel}>Cancel</button>
    </form>
  );
}
