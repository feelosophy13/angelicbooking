import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getSale } from "@/server/sales";
import { formatMoney } from "@/lib/utils";
import { paymentContextForSale } from "@/server/locations";

export default async function ReceiptPage({ params }: { params: Promise<{ slug: string; saleId: string }> }) {
  const { slug, saleId } = await params;
  const { business } = await requireAction(slug, "checkout.take");
  const data = await getSale(business.id, saleId);
  if (!data) notFound();
  const { sale, lines, payments, client, staff } = data;
  const pay = await paymentContextForSale(business, sale.id);
  const taxPct = `${(pay.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  const money = (c: number) => formatMoney(c, business.currency);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  return (
    <div className="mx-auto max-w-sm bg-white p-6 font-mono text-sm print:p-0">
      <div className="text-center">
        <h1 className="text-lg font-bold">{pay.name}</h1>
        {pay.addressLine ? <p>{pay.addressLine}</p> : null}
        {pay.phone ? <p>{pay.phone}</p> : null}
        <p className="mt-2">Receipt #{sale.number}</p>
        <p>{fmt.format(sale.closedAt ?? sale.createdAt)}</p>
        {client ? <p className="mt-1">{client.firstName} {client.lastName}</p> : null}
      </div>
      <hr className="my-3 border-dashed" />
      {lines.filter((l) => l.kind !== "tip").map((l) => (
        <div key={l.id}>
          <div className="flex justify-between"><span>{l.name}{l.quantity > 1 ? ` x${l.quantity}` : ""}</span><span>{money(l.amountCents)}</span></div>
          {l.staffId && staff.find((x) => x.id === l.staffId) ? <p className="text-xs text-stone-500">with {staff.find((x) => x.id === l.staffId)!.displayName}</p> : null}
        </div>
      ))}
      <hr className="my-3 border-dashed" />
      <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotalCents)}</span></div>
      {sale.discountCents ? <div className="flex justify-between"><span>Discount</span><span>-{money(sale.discountCents)}</span></div> : null}
      {sale.taxCents ? <div className="flex justify-between"><span>Tax ({taxPct})</span><span>{money(sale.taxCents)}</span></div> : sale.taxExempt ? <div className="flex justify-between"><span>Tax</span><span>exempt</span></div> : null}
      {sale.tipCents ? <div className="flex justify-between"><span>Tip</span><span>{money(sale.tipCents)}</span></div> : null}
      <div className="mt-1 flex justify-between font-bold"><span>Total</span><span>{money(sale.totalCents)}</span></div>
      <hr className="my-3 border-dashed" />
      {payments.filter((p) => p.status !== "failed" && p.status !== "pending").map((p) => (
        <div key={p.id}>
          <div className="flex justify-between"><span>{p.method.replace("_", " ")}{p.cardLast4 ? ` ****${p.cardLast4}` : ""}</span><span>{money(p.amountCents)}</span></div>
          {p.method === "cash" && p.note?.includes("change") ? <p className="text-xs text-stone-500">{p.note.split(" · ").filter((x) => /^Received|^change/i.test(x)).join(" · ")}</p> : null}
        </div>
      ))}
      {sale.refundedCents ? <div className="flex justify-between"><span>Refunded</span><span>-{money(sale.refundedCents)}</span></div> : null}
      <p className="mt-6 text-center">Thank you!</p>
      {business.receiptFooter ? <p className="mt-2 whitespace-pre-line text-center text-xs">{business.receiptFooter}</p> : null}
      <button onClick={undefined} className="mt-6 w-full rounded border px-3 py-2 print:hidden" formAction={undefined} type="button" data-print>
        Print
      </button>
      <script dangerouslySetInnerHTML={{ __html: `document.querySelector('[data-print]').addEventListener('click',()=>window.print())` }} />
    </div>
  );
}
