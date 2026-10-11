import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsed section for things people do occasionally (add a service to a
 * ticket, apply a discount, edit details). Keeps the page calm: the summary line
 * is always visible, the controls appear on demand. Native <details>, so it
 * works without JavaScript and keeps form state when toggled.
 */
export function Disclosure({ title, hint, open, children, className, defaultOpen }: { title: React.ReactNode; hint?: React.ReactNode; open?: boolean; defaultOpen?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details open={open ?? defaultOpen} className={cn("group rounded-xl border border-stone-200 bg-white shadow-sm", className)}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-stone-800 marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {hint ? <span className="text-xs font-normal text-stone-500">{hint}</span> : null}
      </summary>
      <div className="border-t border-stone-100 px-4 py-4">{children}</div>
    </details>
  );
}
