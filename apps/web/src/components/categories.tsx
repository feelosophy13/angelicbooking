import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, ImageIcon } from "lucide-react";
import { Card, Input } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { cn } from "@/lib/utils";
import { buildTree, flattenTree, type AnyCategory } from "@/server/categories";

/**
 * Category list with rename, reorder and delete. Service categories render as an
 * indented tree (reorder moves among siblings); product categories are flat.
 */
export function CategoryList(props: {
  slug: string;
  kind: "service" | "product";
  categories: AnyCategory[];
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
  const rows = props.kind === "service" ? flattenTree(buildTree(props.categories)) : props.categories.map((c) => ({ ...c, depth: 0, children: [] }));
  const siblingsOf = (c: { parentId?: string | null }) => rows.filter((r) => (r.parentId ?? null) === (c.parentId ?? null));
  return (
    <Card>
      <ul className="divide-y divide-stone-100">
        {rows.map((c) => {
          const sibs = siblingsOf(c);
          const i = sibs.findIndex((s) => s.id === c.id);
          const n = props.counts[c.id] ?? 0;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm" style={{ paddingLeft: `${12 + c.depth * 24}px` }}>
              <form action={props.actions.move} className="flex">
                {hidden({ id: c.id, dir: "up" })}
                <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${c.name} up`}><ArrowUp className="h-4 w-4" /></button>
              </form>
              <form action={props.actions.move} className="flex">
                {hidden({ id: c.id, dir: "down" })}
                <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30" disabled={i === sibs.length - 1} aria-label={`Move ${c.name} down`}><ArrowDown className="h-4 w-4" /></button>
              </form>
              <CategoryThumb imageUrl={c.imageUrl} name={c.name} className="h-8 w-8 rounded-md text-xs" />
              <form action={props.actions.rename} className="flex min-w-0 flex-1 basis-48 items-center gap-1">
                {hidden({ id: c.id })}
                <Input name="name" defaultValue={c.name} className="h-8 min-w-0 max-w-sm flex-1" aria-label={`Name of ${c.name}`} />
                <button className="rounded px-2 py-2.5 text-xs text-stone-600 hover:bg-stone-100 lg:pointer-fine:py-1">Rename</button>
              </form>
              {/* Edit, count and Delete stay together and drop to their own line on a phone. */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href={`/app/${props.slug}/${props.kind === "service" ? "services" : "products"}/categories/${c.id}/edit`} className="rounded px-2 py-2.5 text-xs text-brand-700 hover:bg-brand-50 lg:pointer-fine:py-1">Edit</Link>
              <span className="w-16 text-right text-xs text-stone-400">{n} item{n === 1 ? "" : "s"}</span>
              <form action={props.actions.remove}>
                {hidden({ id: c.id })}
                <ConfirmSubmit title={`Delete “${c.name}”?`} body={`${n} item(s) will become uncategorized${c.children.length ? ` and ${c.children.length} sub-categor${c.children.length === 1 ? "y moves" : "ies move"} up a level` : ""}. This can't be undone.`} confirmLabel="Delete" variant="ghost" className="text-stone-500 hover:text-red-600">Delete</ConfirmSubmit>
              </form>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Category <select> (indented for nested service categories) with the option to type a new one. */
export function CategoryPicker({ name, categories, value, exclude, allowNew = true, emptyLabel = "Uncategorised" }: { name: string; categories: AnyCategory[]; value?: string | null; exclude?: string[]; allowNew?: boolean; emptyLabel?: string }) {
  const rows = flattenTree(buildTree(categories)).filter((c) => !exclude?.includes(c.id));
  return (
    <div className={cn("grid gap-2", allowNew && "sm:grid-cols-2")}>
      <select name={name} defaultValue={value ?? ""} className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm">
        <option value="">{emptyLabel}</option>
        {rows.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth * 2)}{c.depth ? "↳ " : ""}{c.name}</option>)}
      </select>
      {allowNew ? <Input name={`${name}New`} placeholder="…or type a new category" /> : null}
    </div>
  );
}

/** Square image or a soft placeholder with the initial. */
export function CategoryThumb({ imageUrl, name, className, icon }: { imageUrl?: string | null; name: string; className?: string; icon?: "folder" | "image" }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={cn("shrink-0 border border-stone-200 bg-stone-100 object-cover", className)} />;
  }
  const I = icon === "image" ? ImageIcon : FolderOpen;
  return (
    <div className={cn("flex shrink-0 items-center justify-center border border-stone-200 bg-gradient-to-br from-brand-50 to-stone-100 font-semibold text-brand-700", className)} aria-hidden>
      {icon ? <I className="h-1/2 w-1/2 text-brand-300" /> : name.trim().slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Clickable tile used by the admin category browser. */
export function CategoryCard({ href, name, imageUrl, description, meta, children }: { href: string; name: string; imageUrl?: string | null; description?: string | null; meta: string; children?: React.ReactNode }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-brand-200 hover:shadow">
      <Link href={href} className="block">
        <CategoryThumb imageUrl={imageUrl} name={name} className="aspect-[5/3] w-full rounded-none border-0 border-b border-stone-100 text-3xl" />
        <div className="flex items-start gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-stone-900">{name}</p>
            <p className="truncate text-xs text-stone-500">{meta}</p>
            {description ? <p className="mt-1 line-clamp-2 text-xs text-stone-500">{description}</p> : null}
          </div>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-stone-300 group-hover:text-brand-500" />
        </div>
      </Link>
      {children ? <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">{children}</div> : null}
    </div>
  );
}
