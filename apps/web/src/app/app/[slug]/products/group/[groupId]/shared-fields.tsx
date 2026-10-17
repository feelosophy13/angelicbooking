"use client";
import Link from "next/link";
import { useState } from "react";
import { Input, Select, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { ImageField } from "@/components/image-field";

type Group = { name: string; kind: string; taxable: boolean; sellOnline: boolean; description: string | null; imageUrl: string | null; supplierId: string | null };

/** What a product's options share. Taxable and online-store settings only apply to products that are sold. */
export function GroupSharedFields({ group, category, suppliers, storeOn, slug }: { group: Group; /** The category picker, built by the page (it reads from the server). */ category: React.ReactNode; suppliers: { id: string; name: string }[]; storeOn: boolean; slug: string }) {
  const [kind, setKind] = useState(group.kind);
  const retail = kind === "retail";
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={group.name} required /></Field>
      <Field label="What it is" name="kind">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="retail">Sold to clients</option>
          <option value="backbar">Used in services (back-bar)</option>
        </Select>
      </Field>
      <Field label="Category" name="categoryIdNew">{category}</Field>
      {retail ? <Checkbox name="taxable" defaultChecked={group.taxable} label="Taxable" /> : null}
      {retail ? (
        storeOn ? (
          <Checkbox name="sellOnline" defaultChecked={group.sellOnline} label="Sell online" hint="Listed in the shop on your booking page." />
        ) : (
          <p className="text-xs text-stone-500">To sell it online, turn the store on under <Link href={`/app/${slug}/settings/store`} className="underline">Settings → Online store</Link>.</p>
        )
      ) : null}
      <Field label="Description" name="description"><Textarea name="description" rows={4} defaultValue={group.description ?? ""} /></Field>
      <Field label="Photo" name="image"><ImageField name="image" removeName="removeImage" current={group.imageUrl} /></Field>
      {suppliers.length ? (
        <Field label="Usual supplier" name="supplierId" hint="Applies to every option.">
          <Select name="supplierId" defaultValue={group.supplierId ?? ""}>
            <option value="">None</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
