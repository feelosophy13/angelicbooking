import { ChevronLeft, ChevronRight } from "lucide-react";
import type { InvoicePage } from "@/server/billing-overview";
import { formatMoney } from "@/lib/utils";
import { dateShort } from "@/lib/format";
import { rowClass, rowControl } from "@/components/row";
import { StatusBadge } from "@/components/status-badge";
import { Card, Empty, LinkButton } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { openPortalAction } from "./actions";

/**
 * The business's platform invoices from Stripe, newest first, a page at a time, with the Customer Portal button for the
 * card on file. A plain (synchronous) server component so a test can render it with Stripe stood in.
 */
export function InvoicesCard({ slug, page, hasCustomer, portalEnabled, timezone, email }: { slug: string; page: InvoicePage; hasCustomer: boolean; portalEnabled: boolean; timezone: string; email: string | null }) {
  const base = `/app/${slug}/settings/billing`;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="font-medium">Invoices</h2>
        {portalEnabled && hasCustomer ? (
          <ActionForm action={openPortalAction} className={`inline ${rowControl}`}>
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton variant="secondary" size="sm" pendingText="Opening…">Manage payment method</SubmitButton>
          </ActionForm>
        ) : null}
      </div>
      {!hasCustomer ? (
        <div className="p-5"><Empty title="No invoices yet" body="Your first invoice is issued when the subscription starts; each one is listed here and emailed to you." /></div>
      ) : !page.reachable ? (
        <div className="p-5"><Empty title="Invoices are unavailable right now" body="Stripe could not be reached. Reload in a minute; nothing has changed on your account." /></div>
      ) : page.rows.length === 0 ? (
        <div className="p-5"><Empty title="No invoices yet" body={`Your first invoice is issued at the end of the trial and emailed to ${email ?? "you"}.`} /></div>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
          {page.rows.map((r) => (
            <li key={r.id} className={`${rowClass} flex items-center gap-3 px-5 py-3`}>
              <span className="min-w-0 flex-1">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-stone-900 after:absolute after:inset-0 after:content-['']">
                    {r.number}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-stone-900">{r.number}</span>
                )}
                <span className="block text-xs text-stone-500">{dateShort(r.at, timezone)}{r.url ? " · PDF" : ""}</span>
              </span>
              <StatusBadge status={r.status} />
              <span className="w-28 shrink-0 text-right text-sm tabular-nums">{formatMoney(r.amountCents, r.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {page.olderAfter || page.newerBefore ? (
        <div className="flex items-center justify-end gap-1 border-t border-stone-200 px-4 py-2">
          {page.newerBefore ? <LinkButton href={`${base}?before=${encodeURIComponent(page.newerBefore)}`} size="sm"><ChevronLeft className="h-4 w-4" aria-hidden /> Newer</LinkButton> : null}
          {page.olderAfter ? <LinkButton href={`${base}?after=${encodeURIComponent(page.olderAfter)}`} size="sm">Older <ChevronRight className="h-4 w-4" aria-hidden /></LinkButton> : null}
        </div>
      ) : null}
    </Card>
  );
}
