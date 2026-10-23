import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { can, instantToISODate } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { Card, LinkButton, PageHeader, BackLink } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { dateTime } from "@/lib/format";
import { formatMoney } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { invoiceState, payOptions } from "@/lib/invoices";
import { getInvoice, invoiceUrl } from "@/server/invoices";
import { CopyLinkButton, RecordPaymentForm, SendInvoiceForm, VoidInvoiceForm } from "./forms";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; invoiceId: string }> }): Promise<Metadata> {
  const { slug, invoiceId } = await params;
  const { business } = await requireAnyAction(slug, "checkout.take", "sales.view.all");
  const d = await getInvoice(business.id, invoiceId);
  return { title: d ? `Invoice #${d.sale.number}` : "Invoice" };
}

export default async function InvoicePage({ params }: { params: Promise<{ slug: string; invoiceId: string }> }) {
  const { slug, invoiceId } = await params;
  const { business, permissions } = await requireAnyAction(slug, "checkout.take", "sales.view.all");
  const data = await getInvoice(business.id, invoiceId);
  if (!data) notFound();
  const { invoice, sale, lines, payments, client } = data;
  const canSell = can(permissions, "checkout.take");
  const money = (c: number) => formatMoney(c, business.currency);
  const state = invoiceState(invoice, sale, instantToISODate(new Date(), business.timezone));
  const opts = payOptions(invoice.depositType ? { type: invoice.depositType, value: invoice.depositValue ?? 0 } : null, sale);
  const live = sale.status === "open" && invoice.status !== "void";
  const url = invoiceUrl(business, invoice.token);
  const due = invoice.dueOn ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${invoice.dueOn}T12:00:00Z`)) : "On receipt";
  const clientName = client ? `${client.firstName} ${client.lastName ?? ""}`.trim() : "No client";
  const done = payments.filter((p) => p.status !== "pending" && p.status !== "failed");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/sales/invoices`}>Invoices</BackLink></div>
      <PageHeader title={`Invoice #${sale.number}`}>
        {live && canSell ? <LinkButton href={`/app/${slug}/sales/invoices/${invoice.id}/edit`} variant="secondary">Edit</LinkButton> : null}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{client ? <Link href={`/app/${slug}/clients/${client.id}`} className="hover:underline">{clientName}</Link> : clientName}</p>
                <p className="text-sm text-stone-500">Due {due}{invoice.sentAt ? ` · sent ${dateTime(invoice.sentAt, business.timezone)}` : ""}{invoice.viewedAt ? ` · opened ${dateTime(invoice.viewedAt, business.timezone)}` : ""}</p>
              </div>
              <StatusBadge status={state} />
            </div>
            <ul className="divide-y divide-stone-100 text-sm">
              {lines.map((l) => (
                <li key={l.id} className="flex gap-3 py-2">
                  <span className="min-w-0 flex-1">{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span>
                  <span className="w-28 shrink-0 text-right tabular-nums">{money(l.amountCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 border-t border-stone-200 pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(sale.subtotalCents)}</dd></div>
              {sale.discountCents ? <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">-{money(sale.discountCents)}</dd></div> : null}
              {sale.taxCents ? <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{money(sale.taxCents)}</dd></div> : null}
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(sale.totalCents)}</dd></div>
              {sale.paidCents ? <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">-{money(sale.paidCents)}</dd></div> : null}
              {live ? <div className="flex justify-between font-semibold"><dt>Balance</dt><dd className="tabular-nums">{money(opts.balanceCents)}</dd></div> : null}
              {live && opts.depositDueCents ? <div className="flex justify-between text-stone-600"><dt>Deposit asked for now</dt><dd className="tabular-nums">{money(opts.depositDueCents)}</dd></div> : null}
            </dl>
            {invoice.note ? <p className="mt-4 whitespace-pre-line rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{invoice.note}</p> : null}
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-medium">Payments</h2>
            {done.length ? (
              <ul className="divide-y divide-stone-100 text-sm">
                {done.map((p) => (
                  <li key={p.id} className="flex gap-3 py-2">
                    <span className="min-w-0 flex-1">{paymentMethodLabel(p.method)}{p.cardLast4 ? ` ****${p.cardLast4}` : ""}{p.note ? ` · ${p.note}` : ""}<span className="block text-xs text-stone-500">{dateTime(p.createdAt, business.timezone)}{p.createdByUserId ? "" : " · paid online"}{p.refundedCents ? ` · ${money(p.refundedCents)} refunded` : ""}</span></span>
                    <span className="w-28 shrink-0 text-right tabular-nums">{money(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-500">Nothing paid yet.</p>}
            <p className="mt-3 text-xs text-stone-500">
              The money is sale <Link href={`/app/${slug}/sales/${sale.id}`} className="underline">#{sale.number}</Link>: refunds, tips and receipts are done there, and it counts in reports and payroll like any sale.
            </p>
          </Card>
        </div>
        <div className="space-y-6">
          {live && canSell ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-medium">{invoice.status === "draft" ? "Send to the client" : "Send again"}</h2>
              <SendInvoiceForm slug={slug} invoiceId={invoice.id} email={invoice.sentToEmail ?? client?.email ?? ""} phone={invoice.sentToPhone ?? client?.phone ?? ""} sent={invoice.status !== "draft"} />
            </Card>
          ) : null}
          {invoice.status !== "draft" ? (
            <Card className="space-y-2 p-5">
              <h2 className="text-sm font-medium">The client&apos;s link</h2>
              <p className="break-all text-xs text-stone-500">{url}</p>
              <div className="flex flex-wrap gap-2">
                <CopyLinkButton url={url} />
                <LinkButton href={url} target="_blank" size="sm" variant="ghost"><ExternalLink className="h-4 w-4" /> Open</LinkButton>
              </div>
            </Card>
          ) : null}
          {live && canSell ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-medium">Record a check or cash</h2>
              <RecordPaymentForm slug={slug} invoiceId={invoice.id} currency={business.currency} balance={(opts.balanceCents / 100).toFixed(2)} />
            </Card>
          ) : null}
          {live && can(permissions, "checkout.discount") && sale.paidCents === 0 ? <VoidInvoiceForm slug={slug} invoiceId={invoice.id} /> : null}
          {live && invoice.remind && invoice.dueOn && invoice.status === "sent" ? <p className="text-xs text-stone-500">Reminders go out three days before the due date, on it, a day after and a week after{invoice.remindersSent.length ? ` (${invoice.remindersSent.length} sent so far)` : ""}.</p> : null}
        </div>
      </div>
    </>
  );
}
