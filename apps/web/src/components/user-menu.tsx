"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, UserRound, Building2, Check } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserMenu({ user, businesses, currentSlug }: { user: { name: string; email: string }; businesses: { slug: string; name: string }[]; currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-stone-100">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials(user.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-stone-500">{user.email}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 text-stone-400" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
          {businesses.length > 1 ? (
            <div className="border-b border-stone-100 pb-1">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Switch business</p>
              {businesses.map((b) => (
                <Link key={b.slug} href={`/app/${b.slug}`} role="menuitem" onClick={() => setOpen(false)} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-100", b.slug === currentSlug && "font-medium")}>
                  <Building2 className="h-4 w-4 text-stone-400" />
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.slug === currentSlug ? <Check className="h-4 w-4 text-brand-600" /> : null}
                </Link>
              ))}
            </div>
          ) : null}
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-100"><UserRound className="h-4 w-4 text-stone-400" /> Account</Link>
          <button
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              router.push("/sign-in");
              router.refresh();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-100"
          >
            <LogOut className="h-4 w-4 text-stone-400" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
