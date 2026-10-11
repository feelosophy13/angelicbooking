import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Classes for a list row (<li> or <tr>) whose whole surface opens one thing:
 * `relative` so a RowLink inside can stretch over it, plus the hover tint.
 * Controls inside the row (buttons, forms, other links) take `rowControl`
 * so they sit above the stretched link and keep working.
 * (Plain module, no "use client": server pages read these as strings.)
 */
export const rowClass = "relative transition-colors hover:bg-stone-50";
export const rowControl = "relative z-10";

/** The row's primary link: its text stays inline, its hit area becomes the whole row. */
export function RowLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("after:absolute after:inset-0 after:content-['']", className)}>
      {children}
    </Link>
  );
}
