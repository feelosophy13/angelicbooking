"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * A data table that turns into stacked rows on a phone (below `sm`): each row becomes a small card whose first cell is
 * the title and whose other cells read "LABEL value" in two columns, so nothing scrolls sideways. From `sm` up it is a
 * plain table. The labels come from the table's own header row (copied onto each cell as `data-label`, kept current as
 * rows change), so the page writes an ordinary `<thead>` / `<tbody>`. A cell can set its own `data-label`, or `""` to
 * show its value without one. The phone layout is `table[data-stack]` in globals.css.
 */
export function StackTable({ children, ...props }: React.ComponentProps<"table">) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const label = () => {
      const names: string[] = [];
      for (const th of Array.from(table.tHead?.rows[0]?.cells ?? [])) for (let i = 0; i < th.colSpan; i++) names.push(th.textContent?.trim() ?? "");
      for (const section of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
        for (const row of Array.from(section.rows)) {
          let col = 0;
          for (const cell of Array.from(row.cells)) {
            if (cell.dataset.label === undefined && names[col]) cell.dataset.label = names[col];
            col += cell.colSpan;
          }
        }
      }
    };
    label();
    const watch = new MutationObserver(label);
    watch.observe(table, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return (
    <table ref={ref} data-stack="" {...props}>
      {children}
    </table>
  );
}
