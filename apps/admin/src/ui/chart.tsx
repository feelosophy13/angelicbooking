/** Tiny dependency-free SVG charts. Colours come from the CSS tokens so they follow light / dark. */

export function Sparkline({ values, className = "h-10 w-full", color = "var(--brand)", label }: { values: number[]; className?: string; color?: string; label: string }) {
  const w = 120;
  const h = 32;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} role="img" aria-label={label}>
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Bars({ data, label, color = "var(--brand)", height = 140 }: { data: { label: string; value: number }[]; label: string; color?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.label}: ${d.value}`}>
            <span className="mb-0.5 text-center text-[10px] tabular-nums text-ink-3 opacity-0 group-hover:opacity-100">{d.value}</span>
            <div className="mx-auto w-full max-w-14 rounded-t-sm" style={{ height: `${Math.max(d.value === 0 ? 1 : 3, (d.value / max) * 100)}%`, background: color, opacity: d.value === 0 ? 0.25 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <span key={d.label} className="relative h-3 min-w-0 flex-1 text-[10px] text-ink-3">
            {i % 3 === 0 || data.length < 9 ? <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{d.label}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal stacked bar with a legend, for "how many in each status". */
export function Stack({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line" role="img" aria-label={label}>
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</span>
            <span className="tabular-nums font-medium">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, (used / limit) * 100);
  const over = limit > 0 && used > limit;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line" role="meter" aria-label={label} aria-valuenow={used} aria-valuemax={limit}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--warn)" : "var(--brand)" }} />
    </div>
  );
}
