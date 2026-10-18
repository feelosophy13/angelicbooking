"use client";
import { useRouter } from "next/navigation";
import { ClientPicker } from "@/components/client-picker";
import type { QuickClientResult } from "@/app/app/[slug]/clients/actions";

/** The shared client picker; a pick opens that client's conversation. */
export function PickToOpen({ slug, canCreate, createClient }: { slug: string; canCreate: boolean; createClient: (input: { slug: string; firstName: string; lastName: string; phone: string; email: string; confirmDuplicate?: boolean }) => Promise<QuickClientResult> }) {
  const router = useRouter();
  return <ClientPicker slug={slug} initial={null} canCreate={canCreate} createClient={createClient} allowWalkIn={false} placeholder="Search by name, phone or email…" onPick={(c) => c && router.push(`/app/${slug}/inbox/${encodeURIComponent(c.id)}`)} />;
}
