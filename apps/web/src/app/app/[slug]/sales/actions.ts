"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { openWalkInSale } from "@/server/sales";

/** "New sale" on the Sales page: an empty ticket, optionally for a client, at a location. */
export async function newSale(formData: FormData) {
  const d = z.object({ slug: z.string(), clientId: z.string().optional(), locationId: z.string().optional() }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "checkout.take");
  const id = await openWalkInSale({ businessId: ctx.business.id, actorUserId: ctx.user.id, currency: ctx.business.currency, clientId: d.clientId || null, locationId: d.locationId || null });
  redirect(`/app/${d.slug}/sales/${id}`);
}
