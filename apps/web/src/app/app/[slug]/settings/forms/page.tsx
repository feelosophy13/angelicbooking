import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireAction } from "@/lib/tenant";
import { listForms } from "@/server/forms";
import { BackLink, Card, LinkButton, PageHeader, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const forms = await listForms(business.id);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Forms">
        <LinkButton href={`/app/${slug}/settings/forms/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New form</LinkButton>
      </PageHeader>
      <p className="mb-3 text-sm text-stone-600">Intake questionnaires and consent waivers. Clients get a link in their confirmation and reminder, sign on their phone, and the signed copy is kept on their record.</p>
      {forms.length === 0 ? <Empty title="No forms yet" body="Start with a new-client intake or a service waiver." action={{ href: `/app/${slug}/settings/forms/new`, label: "Create a form" }} /> : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`/app/${slug}/settings/forms/${f.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                  <div>
                    <p className={`font-medium ${f.active ? "" : "text-stone-400 line-through"}`}>{f.name}</p>
                    <p className="text-xs text-stone-500">{f.kind === "consent" ? "Consent" : "Intake"} · {f.fields.length} question{f.fields.length === 1 ? "" : "s"} · {f.applyToAll ? "every visit" : f.serviceIds.length ? `${f.serviceIds.length} service${f.serviceIds.length === 1 ? "" : "s"}` : "not assigned"}{f.renewDays ? ` · renews every ${f.renewDays} days` : ""}</p>
                  </div>
                  <span className="text-xs text-stone-400">Edit →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
