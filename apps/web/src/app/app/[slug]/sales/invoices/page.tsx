import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { Card, Empty, Input, LinkButton, PageHeader, Select, Tabs } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { LinkRow } from "@/components/table-row";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/utils";
import { dateTime } from "@/lib/format";
import { INVOICE_STATE_LABEL, INVOICE_STATES, type InvoiceState } from "@/lib/invoices";
import { listInvoices } from "@/server/invoices";
import { salesTabs } from "../tabs";

export const metadata: Metadata = { title: "Invoices" };

type SP = { status?: string; q?: string; page?: string };

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAnyAction(slug, "checkout.take", "sales.view.all");
  const state = sp.status === "unpaid" || (INVOICE_STATES as readonly string[]).includes(sp.status ?? "") ? (sp.status as InvoiceState | "unpaid") : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { rows, total, pageSize, owedCents, overdueCents } = await listInvoices(business, { state, q: sp.q, page });
  const money = (c: number) => formatMoney(c, business.currency);
  const due = (d: string | null) => (d ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)) : "On receipt");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), ...(sp.q ? { q: sp.q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  const filtered = !!(state || sp.q);
  return (
    <>
      <PageHeader title="Sales & checkout">
        {can(permissions, "checkout.take") ? <LinkButton href={`/app/${slug}/sales/invoices/new`} variant="primary"><Plus className="h-4 w-4" /> New invoice</LinkButton> : null}
      </PageHeader>
      <Tabs items={salesTabs(slug)} />
      <Card className="mb-4 p-3">
        <AutoSubmitForm className="flex flex-wrap items-center gap-2">
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-auto">
            <option value="">All invoices</option>
            <option value="unpaid">Unpaid</option>
            {INVOICE_STATES.map((s) => <option key={s} value={s}>{INVOICE_STATE_LABEL[s]}</option>)}
          </Select>
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Invoice # or client name" className="min-w-0 max-w-xs flex-1" />
          {filtered ? <Link href="?" className="text-sm text-stone-600 underline">Clear</Link> : null}
          <span className="ml-auto text-sm text-stone-600">Owed {money(owedCents)}{overdueCents ? <> · <span className="text-red-700">{money(overdueCents)} overdue</span></> : null}</span>
        </AutoSubmitForm>
      </Card>
      {rows.length === 0 ? (
        <Empty
          title={filtered ? "No invoices match" : "No invoices yet"}
          body={filtered ? undefined : "Send a client a bill to pay online: a bridal party, an event, a balance owed or a deposit for a big job."}
          action={!filtered && can(permissions, "checkout.take") ? { href: `/app/${slug}/sales/invoices/new`, label: "New invoice" } : undefined}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Client</th><th className="hidden px-4 py-2 sm:table-cell">Due</th><th className="hidden px-4 py-2 text-right sm:table-cell">Total</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map(({ invoice, sale, clientFirst, clientLast, state: s }) => (
                  <LinkRow key={invoice.id} href={`/app/${slug}/sales/invoices/${invoice.id}`}>
                    <td className="px-4 py-2"><Link href={`/app/${slug}/sales/invoices/${invoice.id}`} className="font-medium text-brand-700 hover:underline">#{sale.number}</Link><span className="block text-xs text-stone-500">{dateTime(invoice.createdAt, business.timezone)}</span></td>
                    <td className="px-4 py-2">{`${clientFirst ?? ""} ${clientLast ?? ""}`.trim() || <span className="text-stone-500">No client</span>}<span className="block text-xs text-stone-500 sm:hidden">Due {due(invoice.dueOn)}</span></td>
                    <td className="hidden whitespace-nowrap px-4 py-2 text-stone-600 sm:table-cell">{due(invoice.dueOn)}</td>
                    <td className="hidden px-4 py-2 text-right tabular-nums sm:table-cell">{money(sale.totalCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s === "void" || s === "paid" ? "" : money(sale.totalCents - sale.paidCents)}</td>
                    <td className="px-4 py-2"><StatusBadge status={s} /></td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm text-stone-600">
              <span>{total} invoices</span>
              <span className="flex gap-2">
                {page > 1 ? <Link href={href(page - 1)} className="underline">Previous</Link> : null}
                {page < pages ? <Link href={href(page + 1)} className="underline">Next</Link> : null}
              </span>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
