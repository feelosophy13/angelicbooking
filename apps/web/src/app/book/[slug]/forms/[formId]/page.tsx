import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBusiness } from "@/server/public-booking";
import { getForm, latestAnswers, prefillFor } from "@/server/forms";
import { withTenant } from "@angelic/db";
import { currentClient } from "@/server/client-auth";
import { SharedForm } from "./shared-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Public, link-shareable form (QR at the desk, link on the website, in a text). */
export default async function SharedFormPage({ params }: { params: Promise<{ slug: string; formId: string }> }) {
  const { slug, formId } = await params;
  const business = await getPublicBusiness(slug);
  if (!business) notFound();
  const form = await getForm(business.id, formId);
  if (!form || !form.active) notFound();
  const me = business.clientAccountsEnabled ? await currentClient(business) : null;
  const defaults = me ? prefillFor(form, me, await withTenant(business.id, (tx) => latestAnswers(tx, me.id, form.id))) : null;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <h1 className="text-xl font-semibold text-stone-900">{form.name}</h1>
      <p className="mb-4 text-sm text-stone-500">{form.kind === "consent" ? "Please read and sign." : "Please answer the questions below."} Your answers are kept on your client record at {business.name}.</p>
      <SharedForm slug={slug} form={form} me={me ? { firstName: me.firstName, lastName: me.lastName } : null} defaults={defaults} />
    </div>
  );
}
