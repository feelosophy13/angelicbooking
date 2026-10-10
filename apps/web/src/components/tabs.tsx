"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Horizontal tabs for a detail page. Highlights from the live pathname (the
 * layout that renders these is not re-rendered on client-side navigation, so a
 * server-computed "current" goes stale): exact match first, else the longest
 * tab href the path starts with, so nested pages keep their parent tab lit.
 */
export function Tabs({ items, current }: { items: { href: string; label: string }[]; current?: string }) {
  const livePath = usePathname();
  const path = livePath || current || "";
  const exact = items.find((t) => t.href === path);
  const active = exact ?? [...items].filter((t) => path.startsWith(t.href + "/") || path === t.href).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active?.href === t.href ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active?.href === t.href ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-stone-600 hover:text-stone-900",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
