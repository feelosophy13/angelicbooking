import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listLocations, loggableProducts, recentUsage } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Card, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { logUsageAction } from "../actions";

export const metadata: Metadata = { title: "Log usage · Inventory" };

/** Supplies used outside a particular visit (opening a new tube, setting up the station), or by anyone who just wants to log them. */
export default async function LogUsagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.log");
  const [products, locations, recent] = await Promise.all([loggableProducts(business.id), listLocations(business.id), recentUsage(business.id)]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-stone-600">Record what was used up. For a particular client, log it on their appointment instead, so it stays with the visit.</p>
      <Card className="p-4">
        <ActionForm action={logUsageAction}>
          <input type="hidden" name="slug" value={slug} />
          <div className={`grid gap-2 ${locations.length > 1 ? "sm:grid-cols-[1fr_12rem_5rem]" : "sm:grid-cols-[1fr_5rem]"}`}>
            <Field label="Product" name="productId"><Select name="productId" defaultValue=""><option value="" disabled>Choose a product…</option>{products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.kind === "backbar" ? " (back-bar)" : ""}</option>)}</Select></Field>
            {locations.length > 1 ? <Field label="Where" name="locationId"><Select name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field> : null}
            <Field label="Units" name="qty"><Input name="qty" inputMode="numeric" placeholder="1" /></Field>
          </div>
          <Field label="Note" name="note"><Input name="note" placeholder="Opened a new tube, station setup…" /></Field>
          <SubmitButton pendingText="Saving…">Log usage</SubmitButton>
        </ActionForm>
      </Card>
      {recent.length ? (
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Logged recently</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>{m.label} <span className="text-stone-500">× {Math.abs(m.delta)}{m.delta > 0 ? " taken back" : ""}{m.note ? ` · ${m.note}` : ""}</span></span>
                <span className="shrink-0 text-xs text-stone-500">{m.who ?? ""} · {fmt.format(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
