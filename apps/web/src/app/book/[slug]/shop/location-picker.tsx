import Link from "next/link";

/** "Buying from: Sterling · Fairfax" for multi-location businesses: the chosen site takes the money and issues the receipt. */
export function StoreLocationPicker({ locations, current, base }: { locations: { id: string; name: string; isDefault: boolean }[]; current: string | null; base: string }) {
  if (locations.length < 2) return null;
  return (
    <p className="text-sm text-stone-600">
      Buying from:{" "}
      {locations.map((l, i) => (
        <span key={l.id}>
          {i ? " · " : ""}
          {l.id === current ? <b>{l.name}</b> : <Link href={`${base}?location=${l.id}`} className="underline" style={{ color: "var(--brand)" }}>{l.name}</Link>}
        </span>
      ))}
    </p>
  );
}
