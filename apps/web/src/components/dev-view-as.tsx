"use client";
import { setViewAs } from "@/app/dev-actions";
import { cn } from "@/lib/utils";

export type ViewAsRole = { key: string; name: string; /** Sees only their own calendar, so it needs a staff member to be. */ needsStaff: boolean };

/** A small amber pill, bottom right, development only: choose which role (and, for a Provider, which staff member) to view the app as. */
export function DevViewAs({ roles, staff, realRole, current }: { roles: ViewAsRole[]; staff: { id: string; name: string }[]; realRole: string; current: string | null }) {
  const active = !!current && current !== realRole;
  return (
    <form action={setViewAs} className={cn("fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg print:hidden", active ? "border-amber-400 bg-amber-100 text-amber-900" : "border-stone-300 bg-white/95 text-stone-600")}>
      <span className="font-semibold uppercase tracking-wide">Dev</span>
      <label className="flex items-center gap-1.5">
        View as
        <select
          key={current ?? ""}
          name="role"
          defaultValue={active ? current! : ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="max-w-[14rem] rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-900"
          aria-label="View the app as another role (development only)"
        >
          <option value="">{roles.find((r) => r.key === realRole)?.name ?? realRole} (you)</option>
          {roles.filter((r) => r.key !== realRole).map((r) =>
            r.needsStaff ? (
              <optgroup key={r.key} label={`${r.name} as…`}>
                {staff.map((s) => <option key={s.id} value={`${r.key}:${s.id}`}>{r.name} · {s.name}</option>)}
              </optgroup>
            ) : (
              <option key={r.key} value={r.key}>{r.name}</option>
            ),
          )}
        </select>
      </label>
    </form>
  );
}
