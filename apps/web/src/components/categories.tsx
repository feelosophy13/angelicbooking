import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Input } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";

type Category = { id: string; name: string; sortOrder: number };

/** Category list with rename, reorder and delete. Creation lives on its own page. */
export function CategoryList(props: {
  slug: string;
  kind: "service" | "product";
  categories: Category[];
  counts: Record<string, number>;
  actions: { rename: (fd: FormData) => Promise<void>; remove: (fd: FormData) => Promise<void>; move: (fd: FormData) => Promise<void> };
}) {
  const hidden = (extra: Record<string, string>) => (
    <>
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="kind" value={props.kind} />
      {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
  if (props.categories.length === 0) return <Card className="p-6 text-center text-sm text-stone-500">No categories yet.</Card>;
  return (
    <Card>
      <ul className="divide-y divide-stone-100">
        {props.categories.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <form action={props.actions.move} className="flex">
              {hidden({ id: c.id, dir: "up" })}
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30" disabled={i === 0} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
            </form>
            <form action={props.actions.move} className="flex">
              {hidden({ id: c.id, dir: "down" })}
              <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30" disabled={i === props.categories.length - 1} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
            </form>
            <form action={props.actions.rename} className="flex flex-1 items-center gap-1">
              {hidden({ id: c.id })}
              <Input name="name" defaultValue={c.name} className="h-8 max-w-sm flex-1" />
              <button className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-100">Rename</button>
            </form>
            <span className="w-16 text-right text-xs text-stone-400">{props.counts[c.id] ?? 0} item{(props.counts[c.id] ?? 0) === 1 ? "" : "s"}</span>
            <form action={props.actions.remove}>
              {hidden({ id: c.id })}
              <ConfirmSubmit title={`Delete “${c.name}”?`} body={`${props.counts[c.id] ?? 0} item(s) will become uncategorised. This can't be undone.`} confirmLabel="Delete" variant="ghost" className="text-stone-500 hover:text-red-600">Delete</ConfirmSubmit>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Category <select> with the option to type a new one. */
export function CategoryPicker({ name, categories, value }: { name: string; categories: Category[]; value?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <select name={name} defaultValue={value ?? ""} className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm">
        <option value="">Uncategorised</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Input name={`${name}New`} placeholder="…or new category" />
    </div>
  );
}
