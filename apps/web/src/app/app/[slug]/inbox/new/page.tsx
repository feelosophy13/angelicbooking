import type { Metadata } from "next";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card } from "@/components/ui";
import { quickCreateClient } from "../../clients/actions";
import { PickToOpen } from "./pick-to-open";

export const metadata: Metadata = { title: "New message" };

/** Start a text with any client: pick them (or add them) and their conversation opens with the composer ready. */
export default async function NewMessagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { permissions } = await requireAction(slug, "clients.write");
  return (
    <>
      <div className="mb-3 lg:hidden"><BackLink href={`/app/${slug}/inbox`}>Inbox</BackLink></div>
      <Card className="p-4">
        <h2 className="mb-1 text-lg font-semibold">New message</h2>
        <p className="mb-3 text-sm text-stone-500">Who is it for? Their conversation opens with the composer ready.</p>
        <PickToOpen slug={slug} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} />
      </Card>
    </>
  );
}
