import { cn } from "@/lib/utils";

/** Logo mark: a soft four-point star in the brand colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#6d28d9" />
      <path d="M16 6c.9 5.4 4.6 9.1 10 10-5.4.9-9.1 4.6-10 10-.9-5.4-4.6-9.1-10-10 5.4-.9 9.1-4.6 10-10z" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("text-lg font-semibold tracking-tight", dark ? "text-white" : "text-stone-900")}>
        Angelic<span className="text-brand-600">Booking</span>
      </span>
    </span>
  );
}
