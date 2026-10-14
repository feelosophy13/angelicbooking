import Link from "next/link";
import type { ReactNode } from "react";

export const TONES = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  brand: "bg-brand-soft text-brand ring-transparent",
  good: "bg-good-soft text-good ring-transparent",
  warn: "bg-warn-soft text-warn ring-transparent",
  bad: "bg-bad-soft text-bad ring-transparent",
  info: "bg-info-soft text-info ring-transparent",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = { active: "good", trialing: "info", past_due: "warn", unpaid: "bad", canceled: "neutral", none: "neutral" };
/** A business with no subscription yet is simply on its free trial; say that instead of "none". */
export function StatusBadge({ status, plan }: { status: string; plan?: string }) {
  if (status === "none") return plan === "cancelled" ? <Badge>cancelled</Badge> : <Badge tone="info">on trial</Badge>;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back && <Link href={back.href} className="mb-2 inline-block text-sm text-ink-3 hover:text-ink">← {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, aside, children, className = "", pad = true }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside && <div className="text-xs text-ink-3">{aside}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, spark, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; spark?: ReactNode; href?: string }) {
  const body = (
    <div className={`h-full rounded-xl border bg-surface p-4 ${tone === "warn" || tone === "bad" ? "border-warn/50" : "border-line"} ${href ? "transition hover:border-brand/50" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
      {spark && <div className="mt-3">{spark}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

const AVATAR = ["#7c3aed", "#0d9488", "#db2777", "#2563eb", "#d97706", "#059669", "#9333ea", "#dc2626"];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white" style={{ width: size, height: size, background: AVATAR[h % AVATAR.length], fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export const BTN = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60";
export const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-brand-ink hover:opacity-90 disabled:opacity-60";
export const BTN_DANGER = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-bad px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";
export const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-3";
export const SELECT = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";

export function relativeDay(d: Date | null, now = Date.now()): string {
  if (!d) return "never";
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}
