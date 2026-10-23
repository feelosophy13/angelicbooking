"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { createInvoice, InvoiceError, recordInvoicePayment, sendInvoice, updateInvoice, voidInvoice, type InvoiceInput, type InvoiceLineInput } from "@/server/invoices";
import { SaleError } from "@/server/sales";

const money = z.number().int().min(0).max(100_000_000);
const lineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("service"), serviceId: z.string().min(1, "Choose a service"), staffId: z.string().nullable(), priceCents: money.nullable() }),
  z.object({ kind: z.literal("product"), productId: z.string().min(1, "Choose a product"), quantity: z.number().int().min(1).max(99), staffId: z.string().nullable() }),
  z.object({ kind: z.literal("custom"), name: z.string().trim().min(1, "Describe each custom line").max(120), unitCents: money, quantity: z.number().int().min(1).max(99), taxable: z.boolean(), staffId: z.string().nullable() }),
]);

const fields = z.object({
  slug: z.string(),
  invoiceId: z.string().optional(),
  clientId: z.string().min(1, "Choose a client"),
  locationId: z.string().optional(),
  lines: z.string(),
  discountType: z.enum(["none", "amount", "percent"]).default("none"),
  discountAmount: f.moneyOptional().optional(),
  discountPercent: z.string().optional(),
  taxExempt: f.checkbox(),
  dueOn: z.string().optional().transform((v) => v || null),
  note: f.optional(1000).optional(),
  depositType: z.enum(["none", "amount", "percent"]).default("none"),
  depositAmount: f.moneyOptional().optional(),
  depositPercent: z.string().optional(),
  remind: f.checkbox(),
});

function toInput(d: z.infer<typeof fields>): InvoiceInput {
  let lines: InvoiceLineInput[];
  try {
    const parsed = z.array(lineSchema).safeParse(JSON.parse(d.lines));
    if (!parsed.success) throw new FormError(parsed.error.issues[0]?.message ?? "Check the lines.", "lines");
    lines = parsed.data;
  } catch (e) {
    if (e instanceof FormError) throw e;
    throw new FormError("Check the lines.", "lines");
  }
  const pct = (v: string | undefined, field: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 100) throw new FormError("Enter a whole percent from 1 to 100", field);
    return n;
  };
  const discount = d.discountType === "amount" ? (d.discountAmount ? { type: "amount" as const, value: d.discountAmount } : null) : d.discountType === "percent" ? { type: "percent" as const, value: pct(d.discountPercent, "discountPercent") } : null;
  const deposit = d.depositType === "amount" ? (d.depositAmount ? { type: "amount" as const, value: d.depositAmount } : null) : d.depositType === "percent" ? { type: "percent" as const, value: pct(d.depositPercent, "depositPercent") } : null;
  if (d.depositType === "percent" && deposit && deposit.value >= 100) throw new FormError("A deposit is less than 100%. Leave it off to ask for the whole amount.", "depositPercent");
  return { clientId: d.clientId, locationId: d.locationId || null, lines, discount, taxExempt: d.taxExempt, dueOn: d.dueOn, note: d.note ?? null, deposit, remind: d.remind };
}

export const saveInvoice = formAction(
  fields,
  async (d) => {
    const { business, user } = await requireAction(d.slug, "checkout.take");
    const input = toInput(d);
    let id = d.invoiceId;
    if (id) await updateInvoice(business, id, input, user.id);
    else id = await createInvoice(business, input, user.id);
    revalidatePath(`/app/${d.slug}/sales/invoices`);
    redirect(`/app/${d.slug}/sales/invoices/${id}`);
  },
  { knownErrors: [InvoiceError, SaleError] },
);

export const sendInvoiceAction = formAction(
  z.object({ slug: z.string(), invoiceId: z.string(), email: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional() }),
  async (d) => {
    const { business, user } = await requireAction(d.slug, "checkout.take");
    await sendInvoice(business, d.invoiceId, { email: d.email || null, phone: d.phone || null }, user.id);
    revalidatePath(`/app/${d.slug}/sales/invoices/${d.invoiceId}`);
    return [d.email, d.phone].filter(Boolean).length === 2 ? "Invoice emailed and texted" : d.email ? `Invoice emailed to ${d.email}` : `Invoice texted to ${d.phone}`;
  },
  { knownErrors: [InvoiceError] },
);

export const recordPaymentAction = formAction(
  z.object({ slug: z.string(), invoiceId: z.string(), method: z.enum(["cash", "check"]), amount: f.money(), checkNumber: f.optional(30).optional() }),
  async (d) => {
    const { business, user } = await requireAction(d.slug, "checkout.take");
    await recordInvoicePayment(business, d.invoiceId, { method: d.method, amountCents: d.amount, checkNumber: d.checkNumber ?? null }, user.id);
    revalidatePath(`/app/${d.slug}/sales/invoices/${d.invoiceId}`);
    return d.method === "cash" ? "Cash payment recorded" : "Check payment recorded";
  },
  { knownErrors: [InvoiceError, SaleError] },
);

/** Voiding is a price change like voiding an unpaid ticket: the discount permission. */
export const voidInvoiceAction = formAction(
  z.object({ slug: z.string(), invoiceId: z.string() }),
  async (d) => {
    const { business, user } = await requireAction(d.slug, "checkout.discount");
    await voidInvoice(business, d.invoiceId, user.id);
    revalidatePath(`/app/${d.slug}/sales/invoices/${d.invoiceId}`);
    return "Invoice voided";
  },
  { knownErrors: [InvoiceError, SaleError] },
);
