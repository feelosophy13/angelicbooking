import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsed section for things people do occasionally (add a service to a
 * ticket, apply a discount, edit details). Keeps the page calm: the summary line
 * is always visible, the controls appear on demand. Native <details>, so it
 * works without JavaScript and keeps form state when toggled.
 *
 * `variant="card"` (default) is its own white card. `variant="inset"` is a thin
 * bordered row with no shadow, for a panel inside a Card (a card never sits in a card).
 * `variant="plain"` has no border at all, for a section inside a box that already
 * has one (a border inside a border looks boxed in).
 */
export function Disclosure({ title, hint, open, children, className, defaultOpen, variant = "card" }: { title: React.ReactNode; hint?: React.ReactNode; open?: boolean; defaultOpen?: boolean; children: React.ReactNode; className?: string; variant?: "card" | "inset" | "plain" }) {
  const inset = variant === "inset";
  const plain = variant === "plain";
  return (
    <details open={open ?? defaultOpen} className={cn("group", plain ? "" : "rounded-xl border border-stone-200", inset ? "rounded-lg" : plain ? "" : "bg-white shadow-sm", className)}>
      <summary className={cn("flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-stone-800 marker:content-none [&::-webkit-details-marker]:hidden", plain ? "py-1" : inset ? "px-3 py-2" : "px-4 py-3")}>
        <ChevronRight className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {hint ? <span className="text-xs font-normal text-stone-500">{hint}</span> : null}
      </summary>
      <div className={plain ? "pb-1 pt-3" : inset ? "px-3 pb-3 pt-1" : "border-t border-stone-100 px-4 py-4"}>{children}</div>
    </details>
  );
}
