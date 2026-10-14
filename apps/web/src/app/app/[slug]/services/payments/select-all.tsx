"use client";

/** Ticks or unticks every service checkbox of one group in the surrounding form. */
export function SelectAll({ group, label }: { group: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[name="id"]${group ? `[data-group="${group}"]` : ""}`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
