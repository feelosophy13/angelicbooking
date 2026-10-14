import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listLocations, stockOverview } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Card, Empty, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { submitCount } from "../actions";
import { LinkButton } from "@/components/ui";
import { ScanBarcode } from "lucide-react";

export const metadata: Metadata = { title: "Count · Inventory" };

/**
 * A physical count: walk the shelf, type what is really there. Products left blank are not touched; the ones that differ are
 * corrected and recorded as a count (so the history shows how far off the book was).
 */
export default async function CountPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ loc?: string; cat?: string; blind?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "inventory.manage");
  const [{ items }, locations] = await Promise.all([stockOverview(business.id), listLocations(business.id)]);
  const multi = locations.length > 1;
  const loc = locations.find((l) => l.id === sp.loc)?.id ?? locations.find((l) => l.isDefault)?.id ?? locations[0]!.id;
  const cats = [...new Set(items.map((i) => i.category ?? "Other"))];
  const shown = items.filter((i) => !sp.cat || (i.category ?? "Other") === sp.cat);
  const blind = sp.blind === "1";
  if (!items.length) return <Empty title="Nothing to count yet" body="Track stock on a product, or import a spreadsheet, first." action={{ href: `/app/${slug}/products`, label: "Products" }} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><LinkButton href={`/app/${slug}/inventory/count/scan`} variant="primary" size="sm"><ScanBarcode className="h-4 w-4" /> Scan to count</LinkButton></div>
      <p className="text-sm text-stone-600">Count the shelf and type what is really there. Leave a product blank to skip it. Anything that differs is corrected and kept in the history.</p>
      <AutoSubmitForm className="flex flex-wrap items-center gap-2">
        {multi ? (
          <Select name="loc" defaultValue={loc} aria-label="Location" className="h-9 w-auto">{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select>
        ) : null}
        <Select name="cat" defaultValue={sp.cat ?? ""} aria-label="Category" className="h-9 w-auto">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-stone-700"><input type="checkbox" name="blind" value="1" defaultChecked={blind} className="h-4 w-4" /> Hide what the book says (blind count)</label>
      </AutoSubmitForm>
      <Card className="p-4">
        <ActionForm action={submitCount}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="locationId" value={loc} />
          <ul className="divide-y divide-stone-100">
            {shown.map((i) => {
              const expected = i.byLocation[loc] ?? 0;
              return (
                <li key={i.id} className="flex items-center gap-3 py-1.5">
                  <label htmlFor={`count:${i.id}`} className="min-w-0 flex-1 truncate text-sm">{productLabel(i)}{!blind ? <span className="text-xs text-stone-500"> · book says {expected}</span> : null}</label>
                  <Input id={`count:${i.id}`} name={`count:${i.id}`} inputMode="numeric" placeholder="—" className="w-20 text-right" />
                </li>
              );
            })}
          </ul>
          <Field label="Note" name="note" hint="Optional, kept with each correction."><Input name="note" placeholder="Monthly count" /></Field>
          <SubmitButton pendingText="Applying…">Apply count</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
