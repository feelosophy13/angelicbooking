const LOOK = {
  draft: ["Draft", "bg-stone-100 text-stone-700"],
  ordered: ["Ordered", "bg-sky-50 text-sky-800"],
  partial: ["Partly received", "bg-amber-50 text-amber-800"],
  received: ["Received", "bg-emerald-50 text-emerald-800"],
  cancelled: ["Cancelled", "bg-stone-100 text-stone-500"],
} as const;

export function StatusPill({ status }: { status: keyof typeof LOOK }) {
  const [label, cls] = LOOK[status];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
