import Link from "next/link";
import { Check, ChevronRight, Clock, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Progress bar across the booking steps. `done` steps link back; the current one is highlighted. */
export function Steps({ labels, current, hrefs }: { labels: string[]; current: number; hrefs: (string | null)[] }) {
  return (
    <ol className="mb-6 flex items-center gap-1 text-xs sm:gap-2 sm:text-sm" aria-label="Booking steps">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        const inner = (
          <span className="flex items-center gap-1.5">
            <span
              className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", state === "todo" ? "bg-stone-200 text-stone-500" : "text-white")}
              style={state === "todo" ? undefined : { background: "var(--brand)" }}
              aria-hidden
            >
              {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span className={cn("hidden sm:inline", state === "current" ? "font-semibold text-stone-900" : state === "done" ? "text-stone-700" : "text-stone-400")}>{label}</span>
            <span className={cn("sm:hidden", state === "current" ? "font-semibold text-stone-900" : "sr-only")}>{label}</span>
          </span>
        );
        return (
          <li key={label} className="flex items-center gap-1 sm:gap-2" aria-current={state === "current" ? "step" : undefined}>
            {state === "done" && hrefs[i] ? <Link href={hrefs[i]!} className="rounded-full hover:opacity-80">{inner}</Link> : inner}
            {i < labels.length - 1 ? <span className={cn("h-px w-4 sm:w-8", n < current ? "bg-[var(--brand)]" : "bg-stone-200")} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p> : null}
    </div>
  );
}

/** Image tile for a category (or a sub-category). */
export function CategoryTile({ href, name, imageUrl, description, meta }: { href: string; name: string; imageUrl: string | null; description: string | null; meta: string }) {
  return (
    <Link href={href} className="group relative block overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
      <div className="relative aspect-[5/3] w-full bg-stone-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl font-semibold" style={{ background: "linear-gradient(135deg, var(--brand-tint), rgba(255,255,255,0.6))", color: "var(--brand-dark)" }}>{name.slice(0, 1)}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8">
          <p className="text-base font-semibold text-white drop-shadow">{name}</p>
          <p className="text-[11px] text-white/80">{meta}</p>
        </div>
      </div>
      {/* Padding lives on the wrapper: padding on a line-clamped element lets a sliver of the next line show. */}
      {description ? <div className="px-3 py-2"><p className="line-clamp-2 text-xs text-stone-500" title={description}>{description}</p></div> : null}
    </Link>
  );
}

/** One bookable service: photo, name, duration, description, price. */
export function ServiceCard({ href, name, imageUrl, description, durationLabel, price, priceFrom, from, deposit }: { href: string; name: string; imageUrl: string | null; description: string | null; durationLabel: string; price: string; /** Providers charge different amounts: the price shown is the lowest. */ priceFrom?: boolean; from?: string; /** The full label, e.g. "$50.00 deposit" or "Pay in full". */ deposit?: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:gap-4 sm:p-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-stone-100 object-cover sm:h-20 sm:w-20" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-lg font-semibold sm:h-20 sm:w-20" style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{name.slice(0, 1)}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-900">{name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><Clock className="h-3.5 w-3.5" aria-hidden />{durationLabel}{from ? <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-500">{from}</span> : null}{deposit ? <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{deposit}</span> : null}</p>
          {description ? <p className="mt-1 line-clamp-2 text-xs text-stone-500">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-semibold text-stone-900">{priceFrom ? <span className="mr-1 text-[11px] font-normal text-stone-500">from</span> : null}{price}</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition group-hover:bg-[var(--brand)] group-hover:text-white" aria-hidden><ChevronRight className="h-4 w-4" /></span>
        </div>
      </Link>
    </li>
  );
}

/** Breadcrumb trail inside the service step (Menu › Hair › Colour). */
export function Crumbs({ items }: { items: { label: string; href: string | null }[] }) {
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-stone-500" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-stone-300" aria-hidden /> : null}
          {c.href ? <Link href={c.href} className="hover:text-stone-900 hover:underline">{c.label}</Link> : <span className="font-medium text-stone-900">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** What has been chosen so far, with links to change each part. */
export function Summary({ imageUrl, title, rows }: { imageUrl: string | null; title: string; rows: { label: string; value: string; href?: string }[] }) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border bg-white p-3 shadow-sm sm:gap-4 sm:p-4" style={{ borderColor: "var(--brand-ring)" }}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover sm:h-16 sm:w-16" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-semibold sm:h-16 sm:w-16" style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{title.slice(0, 1)}</div>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-stone-900">{title}</p>
        <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-[auto_1fr]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-1 sm:contents">
              <dt className="text-stone-400">{r.label}</dt>
              <dd className="flex items-center gap-2 font-medium text-stone-700">{r.value}{r.href ? <Link href={r.href} className="text-[11px] font-normal underline" style={{ color: "var(--brand-dark)" }}>Change</Link> : null}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function Stars({ value, size = "h-3.5 w-3.5" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn(size, n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-stone-200 text-stone-200")} />)}
    </span>
  );
}
