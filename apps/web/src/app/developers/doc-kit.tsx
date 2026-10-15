// Building blocks for the API documentation page and its per-area sections.
export function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-stone-200 bg-stone-900 p-3 text-xs leading-relaxed text-stone-100"><code>{children}</code></pre>;
}

export function Endpoint({ method, path, scope, children }: { method: string; path: string; scope: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{method}</span>
        <code className="text-sm">{path}</code>
        <span className="ml-auto text-xs text-stone-500">needs <code>{scope}</code></span>
      </div>
      {children ? <div className="mt-2 space-y-2 text-sm text-stone-700">{children}</div> : null}
    </div>
  );
}

