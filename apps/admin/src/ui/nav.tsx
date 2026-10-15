"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: "home", exact: true },
  { href: "/tenants", label: "Businesses", icon: "building" },
  { href: "/pricing", label: "Pricing", icon: "tag" },
  { href: "/health", label: "Health", icon: "pulse" },
  { href: "/activity", label: "Activity", icon: "list" },
] as const;

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {ITEMS.map((i) => {
        const on = "exact" in i && i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={on ? "page" : undefined} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${on ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
            <Icon name={i.icon} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: the sidebar becomes a drawer. */
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg border border-line p-2 md:hidden"><Icon name="menu" className="h-5 w-5" /></button>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-surface p-4">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="mb-3 rounded-lg p-1 text-ink-3 hover:text-ink"><Icon name="x" className="h-5 w-5" /></button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
