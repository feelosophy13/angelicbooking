"use client";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui";

/** Finds a service by name or category without drilling through the menu. Submits as a plain GET so it works from a link too. */
export function ServiceSearch({ value, location }: { value: string; location?: string }) {
  const router = useRouter();
  const [text, setText] = useState(value);
  return (
    <form
      role="search"
      className="relative mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        if (location) p.set("location", location);
        if (text.trim()) p.set("q", text.trim());
        router.push(`?${p.toString()}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
      <Input type="search" name="q" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search services, e.g. lash fill" aria-label="Search services" className="pl-9" enterKeyHint="search" />
    </form>
  );
}
