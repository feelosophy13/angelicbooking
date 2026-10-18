"use client";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Lays the inbox out: list beside the conversation from lg up; on a phone the list is the
 * inbox page and a conversation takes the whole screen (its own back link leads home).
 */
export function InboxShell({ base, header, notice, list, children }: { base: string; header: React.ReactNode; notice: React.ReactNode; list: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  const open = path !== base;
  return (
    <>
      <div className={cn(open && "hidden lg:block")}>{header}{notice}</div>
      {/* From lg the two panes share the height left under the page header, each scrolling on its own, so the composer stays in view. */}
      <div className="lg:grid lg:h-[calc(100vh-8.5rem)] lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-6">
        <div className={cn("lg:h-full lg:overflow-y-auto", open && "hidden lg:block")}>{list}</div>
        <div className={cn("min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col", !open && "hidden lg:flex")}>{children}</div>
      </div>
    </>
  );
}
