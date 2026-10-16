import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessForLinks } from "@/server/public-booking";
import { formsForManageToken, prefillFor } from "@/server/forms";
import { getClientSessionId } from "@/lib/client-session";
import { PublicForm } from "./form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicFormsPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const business = await getBusinessForLinks(slug);
  if (!business) notFound();
  const m = await formsForManageToken(business.id, token);
  if (!m || !m.client) notFound();
  const due = m.forms.filter((f) => !f.current);
  // A manage link proves someone booked, not who they are: earlier answers (health details) and contact details on file are only
  // filled in for the client signed in as this record.
  const isThem = (await getClientSessionId(business.id)) === m.client.id;
  const done = m.forms.filter((f) => f.current);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Your forms</h1>
        <p className="text-sm text-stone-600">{due.length === 0 ? "Everything is complete. See you soon!" : `Please complete ${due.length === 1 ? "this form" : `these ${due.length} forms`} before your visit.`}</p>
      </div>
      {due.map(({ form }) => (
        <section key={form.id} className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 font-medium">{form.name}</h2>
          <PublicForm slug={slug} token={token} form={form} clientName={`${m.client!.firstName} ${m.client!.lastName}`.trim()} defaults={isThem ? prefillFor(form, m.client ?? null, due.find((d) => d.form.id === form.id)?.submission?.answers ?? null) : null} />
        </section>
      ))}
      {done.length ? <p className="text-xs text-stone-500">Already on file: {done.map((d) => d.form.name).join(", ")}.</p> : null}
      <Link href={`/book/${slug}/manage/${token}`} className="inline-block text-sm underline" style={{ color: "var(--brand)" }}>Back to your appointment</Link>
    </div>
  );
}
