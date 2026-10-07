"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand";

export type NavSection = { title: string; items: { href: string; label: string; exact?: boolean; iconName: string }[] };

/**
 * Phone navigation: a top bar with the wordmark and a menu button that opens a
 * slide-in drawer with the full grouped menu, plus a bottom tab bar with the
 * four most-used destinations. Hidden at md and up (the sidebar takes over).
 */
export function MobileNav({ sections, businessName, userName, tabs, children }: { sections: NavSection[]; businessName: string; userName: string; tabs: { href: string; label: string; exact?: boolean; iconName: string }[]; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/95 px-3 py-2 backdrop-blur md:hidden">
        <Link href="/" aria-label="Home"><Wordmark className="scale-90" /></Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="rounded-lg p-2 text-stone-700 hover:bg-stone-100">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-stone-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(86vw,20rem)] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{businessName}</p>
                <p className="truncate text-xs text-stone-500">{userName}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-stone-700 hover:bg-stone-100"><X className="h-5 w-5" /></button>
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto p-3">
              {sections.map((s, i) => (
                <div key={i}>
                  {s.title ? <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{s.title}</p> : null}
                  <div className="space-y-0.5">
                    {s.items.map((n) => (
                      <Link key={n.href} href={n.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px]", isActive(n.href, n.exact) ? "bg-brand-50 font-medium text-brand-700" : "text-stone-700 hover:bg-stone-100")}>
                        <Icon name={n.iconName} className="h-5 w-5 text-stone-400" />
                        {n.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t border-stone-200 p-2">{children}</div>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Quick navigation">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(t.href, t.exact) ? "text-brand-700" : "text-stone-500")}>
            <Icon name={t.iconName} className="h-5 w-5" />
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

import { CalendarDays, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, Receipt } from "lucide-react";
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { CalendarDays, ListOrdered, Clock, Users, UserCog, Scissors, ShoppingBag, Package, BadgePercent, Gift, BarChart3, Wallet, Settings, Receipt };
function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? CalendarDays;
  return <C className={className} />;
}
