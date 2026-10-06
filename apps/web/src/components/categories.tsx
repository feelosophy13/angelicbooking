import { Button, Card, Input } from "@/components/ui";

type Category = { id: string; name: string; sortOrder: number };

/**
 * Category manager used by the Services and Products pages. The four actions
 * are server actions bound to the page's slug and kind via hidden fields.
 */
export function CategoryManager(props: {
  slug: string;
  kind: "service" | "product";
  categories: Category[];
  counts: Record<string, number>;
  actions: { create: (fd: FormData) => Promise<void>; rename: (fd: FormData) => Promise<void>; remove: (fd: FormData) => Promise<void>; move: (fd: FormData) => Promise<void> };
}) {
  const hidden = (extra?: Record<string, string>) => (
    <>
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="kind" value={props.kind} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Categories</h2>
      <p className="mb-3 text-xs text-stone-500">Order here is the order shown {props.kind === "service" ? "on the booking page and in menus" : "at checkout"}.</p>
      {props.categories.length === 0 ? <p className="mb-3 text-sm text-stone-500">No categories yet.</p> : (
        <ul className="mb-3 divide-y divide-stone-100">
          {props.categories.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm">
              <form action={props.actions.move} className="flex">
                {hidden({ id: c.id, dir: "up" })}
                <button className="px-1 text-stone-400 hover:text-stone-800 disabled:opacity-30" disabled={i === 0} aria-label="Move up">▲</button>
              </form>
              <form action={props.actions.move} className="flex">
                {hidden({ id: c.id, dir: "down" })}
                <button className="px-1 text-stone-400 hover:text-stone-800 disabled:opacity-30" disabled={i === props.categories.length - 1} aria-label="Move down">▼</button>
              </form>
              <form action={props.actions.rename} className="flex flex-1 items-center gap-1">
                {hidden({ id: c.id })}
                <Input name="name" defaultValue={c.name} className="h-8 flex-1" />
                <button className="rounded px-2 py-1 text-xs text-stone-600 hover:bg-stone-100">Rename</button>
              </form>
              <span className="w-8 text-right text-xs text-stone-400">{props.counts[c.id] ?? 0}</span>
              <form action={props.actions.remove}>
                {hidden({ id: c.id })}
                <button className="px-1 text-xs text-stone-400 hover:text-red-600" aria-label="Delete category">✕</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={props.actions.create} className="flex gap-2">
        {hidden()}
        <Input name="name" placeholder="New category" required className="h-9" />
        <Button type="submit" size="sm" variant="secondary">Add</Button>
      </form>
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
