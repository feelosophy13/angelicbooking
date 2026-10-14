import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { productLabel } from "@/lib/inventory";

type Option = { id: string; name: string; variantLabel: string | null; kind: string; category?: string | null };

/** One product out of any number: the searchable, grouped list the service pickers use, here for products (grouped by category). */
export function ProductPicker({ name, products, placeholder = "Choose a product" }: { name: string; products: Option[]; placeholder?: string }) {
  const byCat = new Map<string, Option[]>();
  for (const p of products) byCat.set(p.category ?? "Other", [...(byCat.get(p.category ?? "Other") ?? []), p]);
  const groups: ServiceGroup[] = [...byCat.entries()].map(([cat, list]) => ({
    id: cat,
    name: cat,
    services: list.map((p) => ({ id: p.id, name: productLabel(p), meta: p.kind === "backbar" ? "back-bar" : "also sold" })),
  }));
  return <ServicePicker name={name} groups={groups} value={null} placeholder={placeholder} />;
}
