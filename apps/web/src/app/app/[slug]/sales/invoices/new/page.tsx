import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { can } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { shiftISODate } from "@/lib/utils";
import { instantToISODate } from "@angelic/core";
import { InvoiceFields } from "../invoice-fields";
import { invoiceEditorData } from "../editor-data";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ clientId?: string }> }) {
  const { slug } = await params;
  const { clientId } = await searchParams;
  const { business, permissions } = await requireAction(slug, "checkout.take");
  const data = await invoiceEditorData(business);
  // Started from a client's page: that client is filled in.
  const client = clientId ? await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { id: true, firstName: true, lastName: true } })) : null;
  return (
    <FormPage title="New invoice" backHref={`/app/${slug}/sales/invoices`} backLabel="Invoices" width="max-w-3xl">
      <InvoiceFields
        {...data}
        slug={slug}
        canCreateClient={can(permissions, "clients.write")}
        defaultClient={client ? { id: client.id, name: `${client.firstName} ${client.lastName ?? ""}`.trim() } : null}
        defaultDueOn={shiftISODate(instantToISODate(new Date(), business.timezone), 14)}
      />
    </FormPage>
  );
}
