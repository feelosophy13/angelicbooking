import { cn } from "@/lib/utils";

/** Logo mark: the Angelic Beauty monogram (the AB with its leaf and spark), warm brown line art on transparent (`public/brand/mark.svg`). */
export function LogoMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mark.svg" alt="" aria-hidden className={cn("h-7 w-7", className)} />;
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

/** The business's own mark for the staff app's header: its logo, or its first letter on the app color. */
export function BusinessMark({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className={cn("h-8 w-8 shrink-0 rounded-lg border border-stone-200 bg-white object-cover", className)} />
  ) : (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white", className)} aria-hidden>{name.trim().slice(0, 1).toUpperCase()}</span>
  );
}

/** "Powered by Angelic Booking" at the foot of client-facing pages, linking to the marketing site. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <a href="https://angelicbooking.com" target="_blank" rel="noreferrer" className={cn("hit text-xs text-stone-500 hover:text-stone-700", className)}>
      Powered by <span className="font-semibold text-stone-700">Angelic Booking</span>
    </a>
  );
}
