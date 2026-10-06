import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, schema } from "@angelic/db";

/** Custom domain entry: look up the business by hostname and send to its booking page. */
export default async function HostEntry({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const b = await db.query.businesses.findFirst({ where: eq(schema.businesses.customDomain, host.toLowerCase()) });
  if (!b) notFound();
  redirect(`/book/${b.slug}`);
}
