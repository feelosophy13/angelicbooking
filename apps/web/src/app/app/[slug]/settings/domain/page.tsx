import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { Card, FormPage, Input, Notice } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { STATUS_LABEL, ownershipRecord, type DomainStatus } from "@/lib/custom-domain";
import { instructions, ownershipToken } from "@/server/custom-domain";
import { deleteDomain, recheckDomain, saveDomain } from "./actions";

const BADGE: Record<DomainStatus, string> = {
  none: "bg-stone-100 text-stone-600 ring-stone-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  problem: "bg-red-50 text-red-700 ring-red-200",
  manual: "bg-sky-50 text-sky-800 ring-sky-200",
};

export const metadata: Metadata = { title: "Custom domain" };

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const host = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "");
  const status = business.customDomainStatus as DomainStatus;
  const advice = business.customDomain && status !== "none" ? await instructions(business.customDomain) : null;
  // The TXT record proves the address is this salon's; it's needed until the address is active.
  const ownership = business.customDomain && status !== "none" && status !== "active" ? ownershipRecord(business.customDomain, ownershipToken(business.id, business.customDomain)) : null;
  const checked = business.customDomainCheckedAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone }).format(business.customDomainCheckedAt) : null;
  return (
    <FormPage title="Custom booking domain" backHref={`/app/${slug}/settings`} backLabel="Settings">
      <p className="mb-4 text-sm text-stone-600">Serve your booking page from your own address, like book.yoursalon.com, instead of {host}/book/{business.slug}. You need a domain you own and access to its DNS settings.</p>

      {business.customDomain ? (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{business.customDomain}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-stone-500"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[status]}`}>{STATUS_LABEL[status]}</span>{checked ? `checked ${checked}` : ""}</div>
            </div>
            <div className="flex gap-2">
              {status !== "manual" ? (
                <ActionForm action={recheckDomain} className="inline">
                  <input type="hidden" name="slug" value={slug} />
                  <SubmitButton variant="secondary" pendingText="Checking…">Check now</SubmitButton>
                </ActionForm>
              ) : null}
              <ActionForm action={deleteDomain} className="inline">
                <input type="hidden" name="slug" value={slug} />
                <ConfirmSubmit variant="ghost" title="Remove this address?" body="Your booking page goes back to the standard address. Links that use your own address will stop working." confirmLabel="Remove">Remove</ConfirmSubmit>
              </ActionForm>
            </div>
          </div>
          {status === "active" ? <p className="mt-3 text-sm text-emerald-700">It works: clients who visit {business.customDomain} land on your booking page. A secure padlock can take a few more minutes the first time.</p> : null}
          {status === "manual" ? <div className="mt-3"><Notice>{business.customDomainError ?? "We will connect this address for you."} You will still need the DNS record below.</Notice></div> : null}
          {status === "pending" || status === "problem" ? (
            <div className="mt-3">
              <Notice>{business.customDomainError ?? "Waiting for the DNS record below. This can take from a few minutes to an hour after you add it. We check every few minutes."}</Notice>
            </div>
          ) : null}
          {advice ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Add {ownership ? "these records" : "this record"} where you manage your domain&apos;s DNS</h3>
              <table className="mt-2 w-full max-w-xl text-sm">
                <thead className="text-left text-xs text-stone-500"><tr><th className="py-1 pr-4 font-medium">Type</th><th className="py-1 pr-4 font-medium">Name</th><th className="py-1 font-medium">Value</th></tr></thead>
                <tbody>
                  <tr className="font-mono"><td className="py-1 pr-4">{advice.type}</td><td className="py-1 pr-4">{advice.name}</td><td className="py-1 break-all">{advice.value}</td></tr>
                  {ownership ? <tr className="font-mono"><td className="py-1 pr-4">{ownership.type}</td><td className="py-1 pr-4">{ownership.name}</td><td className="py-1 break-all">{ownership.value}</td></tr> : null}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-stone-500">{advice.note}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      <ActionForm action={saveDomain}>
        <input type="hidden" name="slug" value={slug} />
        <Field label={business.customDomain ? "Use a different address" : "Your address"} name="customDomain" hint="For example book.yoursalon.com. Not your main website address unless you want the booking page there.">
          <Input name="customDomain" defaultValue="" placeholder="book.yoursalon.com" autoComplete="off" />
        </Field>
        <SubmitButton pendingText="Saving…">{business.customDomain ? "Switch to this address" : "Connect this address"}</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
