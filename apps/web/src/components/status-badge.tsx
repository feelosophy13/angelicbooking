import { statusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  booked: "bg-brand-50 text-brand-700 ring-brand-200",
  confirmed: "bg-sky-50 text-sky-800 ring-sky-200",
  checked_in: "bg-amber-50 text-amber-800 ring-amber-200",
  in_progress: "bg-orange-50 text-orange-800 ring-orange-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  succeeded: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  sent: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  finalized: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  open: "bg-brand-50 text-brand-700 ring-brand-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  queued: "bg-amber-50 text-amber-800 ring-amber-200",
  sending: "bg-sky-50 text-sky-800 ring-sky-200",
  unverified: "bg-amber-50 text-amber-800 ring-amber-200",
  pending_review: "bg-sky-50 text-sky-800 ring-sky-200",
  in_review: "bg-sky-50 text-sky-800 ring-sky-200",
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  released: "bg-stone-100 text-stone-500 ring-stone-200",
  skipped: "bg-amber-50 text-amber-800 ring-amber-200",
  partially_refunded: "bg-amber-50 text-amber-800 ring-amber-200",
  paused: "bg-amber-50 text-amber-800 ring-amber-200",
  no_show: "bg-stone-100 text-stone-600 ring-stone-200",
  cancelled: "bg-stone-100 text-stone-500 ring-stone-200",
  void: "bg-stone-100 text-stone-500 ring-stone-200",
  refunded: "bg-stone-100 text-stone-600 ring-stone-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[status] ?? "bg-stone-100 text-stone-700 ring-stone-200", className)}>
      {statusLabel(status)}
    </span>
  );
}
