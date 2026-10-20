import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { duration } from "@/lib/format";
import { Button, Card } from "@/components/ui";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { CategoryThumb } from "@/components/categories";
import { moveService, toggleServiceActive } from "./actions";

export type ServiceRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  durationMin: number;
  gapMin: number;
  finishMin: number;
  bufferAfterMin: number;
  priceCents: number;
  depositCents: number;
  depositType: string;
  depositPercent: number;
  capacity: number;
  bookableOnline: boolean;
  active: boolean;
};

/** One card listing services (a category's, or a group on the full list) with move / hide controls. */
/** `prices` false hides the price column and the deposit amount ("See prices" is its own permission). */
export function ServiceRows({ slug, title, titleHref, services, currency, manage, onlyAt, emptyText, prices = true }: { slug: string; title?: string; titleHref?: string; services: ServiceRow[]; currency: string; manage: boolean; onlyAt: (serviceId: string) => string; emptyText?: string; prices?: boolean }) {
  const list = services;
  return (
    <Card>
      {title ? <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{titleHref ? <Link href={titleHref} className="hover:underline">{title}</Link> : title}</h2> : null}
      {list.length === 0 ? <p className="px-4 py-6 text-center text-sm text-stone-500">{emptyText ?? "No services here yet."}</p> : null}
      <ul className="divide-y divide-stone-200">
        {list.map((s, idx) => (
          <li key={s.id} className={`flex items-center gap-3 px-4 py-3 ${manage ? rowClass : ""}`}>
            {manage && list.length > 1 ? (
              <div className={`-my-1 flex flex-col ${rowControl}`}>
                <form action={moveService}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="dir" value="up" /><button aria-label={`Move ${s.name} up`} disabled={idx === 0} className="hit rounded p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button></form>
                <form action={moveService}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="dir" value="down" /><button aria-label={`Move ${s.name} down`} disabled={idx === list.length - 1} className="hit rounded p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button></form>
              </div>
            ) : null}
            <CategoryThumb imageUrl={s.imageUrl} name={s.name} icon="image" className="h-12 w-12 rounded-lg" />
            <div className="min-w-0 flex-1">
              {manage ? (
                // Stretches over the whole row (after:inset-0); the arrows and Hide/Show sit above it.
                <RowLink href={`/app/${slug}/services/${s.id}`} className={`font-medium ${s.active ? "" : "text-stone-400 line-through"}`}>{s.name}</RowLink>
              ) : (
                <p className={s.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{s.name}</p>
              )}
              <p className="text-xs text-stone-500">
                {duration(s.durationMin)}
                {s.gapMin ? ` + ${duration(s.gapMin)} processing` : ""}
                {s.finishMin ? ` + ${duration(s.finishMin)} finish` : ""}
                {s.bufferAfterMin ? ` + ${duration(s.bufferAfterMin)} buffer` : ""}
                {s.depositType === "full" ? " · paid in full online" : s.depositType === "percent" && s.depositPercent ? ` · ${s.depositPercent}% deposit` : s.depositCents ? (prices ? ` · deposit ${formatMoney(s.depositCents, currency)}` : " · deposit") : ""}
                {s.capacity > 1 ? ` · class of ${s.capacity}` : ""}
                {!s.bookableOnline ? " · not online" : ""}
                {onlyAt(s.id)}
              </p>
            </div>
            {prices ? <span className="w-28 shrink-0 text-right font-medium tabular-nums">{formatMoney(s.priceCents, currency)}</span> : null}
            {manage ? (
              <form action={toggleServiceActive} className={rowControl}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="serviceId" value={s.id} />
                <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                <Button size="sm" variant="ghost" type="submit">{s.active ? "Hide" : "Show"}</Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
