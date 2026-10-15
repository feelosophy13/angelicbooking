// Building blocks for the API documentation page and its per-area sections.
import { Link2 } from "lucide-react";
import { CopyButton } from "./copy-button";

export function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2"><CopyButton text={children} /></div>
      <pre className="overflow-x-auto rounded-lg border border-stone-200 bg-stone-900 p-3 pr-20 text-xs leading-relaxed text-stone-100"><code>{children}</code></pre>
    </div>
  );
}

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800",
  POST: "bg-sky-100 text-sky-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-amber-100 text-amber-800",
  DELETE: "bg-red-100 text-red-800",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One endpoint: the method, the path, the scope it needs, and what it does. `data-endpoint` lets the page's search filter it. */
export function Endpoint({ method, path, scope, children }: { method: string; path: string; scope: string; children?: React.ReactNode }) {
  const id = `${method.toLowerCase()}-${slug(path)}`;
  return (
    <div id={id} data-endpoint className="group scroll-mt-20 rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-16 rounded px-1.5 py-0.5 text-center font-mono text-xs font-semibold ${METHOD_STYLE[method] ?? "bg-stone-100 text-stone-800"}`}>{method}</span>
        <code className="break-all text-sm font-medium">{path}</code>
        <a href={`#${id}`} aria-label={`Link to ${method} ${path}`} className="text-stone-300 opacity-0 hover:text-stone-600 group-hover:opacity-100 focus:opacity-100"><Link2 className="h-3.5 w-3.5" aria-hidden /></a>
        <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[11px] text-stone-600">{scope}</span>
      </div>
      {children ? <div className="mt-2 space-y-2 text-sm text-stone-700">{children}</div> : null}
    </div>
  );
}

/** A heading that groups the sections after it in the page's side list ("Catalog and inventory"). */
export function Group({ title }: { title: string }) {
  return <h1 data-group className="!mt-14 text-2xl font-semibold tracking-tight">{title}</h1>;
}
