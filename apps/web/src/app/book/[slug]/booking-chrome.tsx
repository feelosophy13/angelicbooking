"use client";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

/** Query params that mean the client is past the landing view and picking a service, time or details. */
const STEP_PARAMS = ["category", "service", "staff", "date", "time", "session"];

/**
 * Wraps the hero. On the booking page itself, once the client has started choosing, the cover
 * collapses to a slim bar (children style themselves with `group-data-[compact=true]/hdr:`), so
 * the choices sit near the top of the screen instead of under a full photo.
 */
export function HeaderShell({ base, children }: { base: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="group/hdr">{children}</div>}>
      <Shell base={base}>{children}</Shell>
    </Suspense>
  );
}

function Shell({ base, children }: { base: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const compact = pathname === base && STEP_PARAMS.some((k) => params.has(k));
  return <div className="group/hdr" data-compact={compact ? "true" : "false"}>{children}</div>;
}

/** "Start over" while choosing, "Book an appointment" from the shop, account and other pages; nothing on the landing view. */
export function BookingHomeLink({ base }: { base: string }) {
  return (
    <Suspense fallback={null}>
      <Home base={base} />
    </Suspense>
  );
}

function Home({ base }: { base: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onBase = pathname === base;
  if (onBase && !STEP_PARAMS.some((k) => params.has(k)) && !params.has("location")) return null;
  return (
    <Link href={base} className="mb-3 flex w-fit items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {onBase ? "Start over" : "Book an appointment"}
    </Link>
  );
}
