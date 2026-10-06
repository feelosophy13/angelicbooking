"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
        active ? "bg-brand-50 text-brand-700" : "text-stone-700 hover:bg-stone-100",
      )}
    >
      {children}
    </Link>
  );
}
