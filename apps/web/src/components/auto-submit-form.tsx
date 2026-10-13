"use client";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A filter form with no Apply button: changing any control in it loads the page again with the new choice in the
 * address (blank values are left out, so addresses stay short). Without JavaScript the form still submits normally
 * when the visitor presses Enter. Use it for single-choice filters; pages with text boxes keep an explicit Apply.
 */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  return (
    <form
      method="get"
      aria-busy={pending}
      className={cn(pending && "opacity-70 transition-opacity", className)}
      onChange={(e) => {
        const params = new URLSearchParams();
        for (const [k, v] of new FormData(e.currentTarget)) if (typeof v === "string" && v) params.set(k, v);
        const qs = params.toString();
        start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
      }}
    >
      {children}
    </form>
  );
}
