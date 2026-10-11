"use client";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ServiceTreeNode } from "@/server/service-groups";
import { cn } from "@/lib/utils";

/**
 * Pick any number of services from the category tree. Every category row has an all/none box
 * covering everything beneath it (partial state when only some are ticked), a "picked of total"
 * count, and expands to its own services and child categories. A search filter narrows the tree.
 * Posts one `name` value per picked service id.
 */
export function ServiceCheckboxes({ name, tree, selected }: { name: string; tree: ServiceTreeNode[]; selected: string[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [open, setOpen] = useState<Set<string>>(() => new Set(withPicked(tree, new Set(selected))));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? filterTree(tree, needle) : tree), [tree, needle]);
  const total = useMemo(() => tree.reduce((n, t) => n + idsUnder(t).length, 0), [tree]);
  const setMany = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const id of ids) if (on) n.add(id); else n.delete(id); return n; });
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const Node = ({ node, depth }: { node: ServiceTreeNode; depth: number }) => {
    const ids = idsUnder(node);
    const n = ids.filter((id) => picked.has(id)).length;
    const all = n === ids.length && ids.length > 0;
    const isOpen = needle ? true : open.has(node.id);
    return (
      <li>
        <div className="flex items-center gap-2 py-2 pr-3" style={{ paddingLeft: `${12 + depth * 22}px` }}>
          <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = n > 0 && !all; }} onChange={(e) => setMany(ids, e.target.checked)} aria-label={`All ${node.name}`} className="h-4 w-4 rounded border-stone-300 text-brand-600" />
          <button type="button" onClick={() => flip(node.id)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm" aria-expanded={isOpen}>
            <span className={cn("truncate", depth === 0 ? "font-semibold text-stone-900" : "font-medium text-stone-800")}>{node.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500">{n ? `${n} of ${ids.length}` : ids.length}<ChevronDown className={cn("h-4 w-4 transition", isOpen && "rotate-180")} /></span>
          </button>
        </div>
        {isOpen ? (
          <>
            {node.services.length ? (
              <div className="grid gap-1 bg-stone-50/60 py-2 pr-3 sm:grid-cols-2" style={{ paddingLeft: `${36 + depth * 22}px` }}>
                {node.services.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => setMany([s.id], e.target.checked)} className="h-4 w-4 rounded border-stone-300 text-brand-600" />
                    <span className="min-w-0 truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {node.children.length ? <ul className="divide-y divide-stone-100 border-t border-stone-100">{node.children.map((c) => <Node key={c.id} node={c} depth={depth + 1} />)}</ul> : null}
          </>
        ) : null}
      </li>
    );
  };
  return (
    <div className="space-y-2">
      {[...picked].map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service" className="h-8 w-56 rounded-lg border border-stone-300 bg-white px-2.5 text-xs" aria-label="Find a service" />
        <span className="text-xs text-stone-500">{picked.size} of {total} selected</span>
        {picked.size ? <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-stone-500 underline">Clear</button> : null}
      </div>
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {shown.map((node) => <Node key={node.id} node={node} depth={0} />)}
        {shown.length === 0 ? <li className="px-3 py-3 text-sm text-stone-500">No service matches “{q}”.</li> : null}
      </ul>
    </div>
  );
}

function idsUnder(node: ServiceTreeNode): string[] {
  return [...node.services.map((s) => s.id), ...node.children.flatMap(idsUnder)];
}

/** Categories that hold at least one picked service, so they start expanded. */
function withPicked(nodes: ServiceTreeNode[], picked: Set<string>): string[] {
  return nodes.flatMap((n) => (idsUnder(n).some((id) => picked.has(id)) ? [n.id, ...withPicked(n.children, picked)] : []));
}

function filterTree(nodes: ServiceTreeNode[], needle: string): ServiceTreeNode[] {
  return nodes
    .map((n) => {
      if (n.name.toLowerCase().includes(needle)) return n;
      const services = n.services.filter((s) => s.name.toLowerCase().includes(needle));
      const children = filterTree(n.children, needle);
      return { ...n, services, children };
    })
    .filter((n) => n.services.length || n.children.length);
}
