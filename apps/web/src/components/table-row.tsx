"use client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A table row that opens `href` when clicked anywhere, except on a control
 * inside it (link, button, input). Tables can't host the stretched-link
 * trick lists use (a <tr> isn't a reliable containing block), so this one
 * navigates on click and keeps the row's own name link for middle-click,
 * right-click and keyboard users.
 */
export function LinkRow({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={cn("cursor-pointer transition-colors hover:bg-stone-50", className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, form")) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
