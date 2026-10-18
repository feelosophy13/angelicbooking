"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";

/**
 * One line of the ticket: the cells, then a quiet Edit / remove pair at the right. Edit opens the line's form in a
 * full-width row underneath, so the narrow actions column never holds a form. Closed sales pass no editor or remove.
 */
export function LineRow({ children, editor, remove }: { children: React.ReactNode; /** The edit form (open ticket, editable line). */ editor?: React.ReactNode; /** The remove form, a quiet icon button (open ticket). */ remove?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        {children}
        <td className="w-16 py-2 pl-2 align-top">
          {editor || remove ? (
            <div className="flex justify-end gap-0.5">
              {editor ? (
                <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Close editor" : "Edit line"} title={open ? "Close" : "Edit"} className={`rounded-md p-1.5 hover:bg-stone-100 ${open ? "bg-stone-100 text-stone-800" : "text-stone-400 hover:text-stone-800"}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
              {remove}
            </div>
          ) : null}
        </td>
      </tr>
      {open && editor ? (
        <tr className="border-t-0!">
          <td colSpan={3} className="pb-3">{editor}</td>
        </tr>
      ) : null}
    </>
  );
}
