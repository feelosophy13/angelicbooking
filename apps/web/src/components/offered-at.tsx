/** "Offered at" tick boxes for a service; renders nothing for a single-location business. Posts loc_<id> + hasLocations. */
export function OfferedAt({ locations, selected }: { locations: { id: string; name: string }[]; selected: string[] }) {
  if (locations.length < 2) return null;
  const all = selected.length === 0;
  return (
    <fieldset className="rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-sm font-medium text-stone-700">Offered at</legend>
      <input type="hidden" name="hasLocations" value="1" />
      <div className="flex flex-wrap gap-4">
        {locations.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`loc_${l.id}`} defaultChecked={all || selected.includes(l.id)} className="h-4 w-4 accent-brand-600" /> {l.name}</label>
        ))}
      </div>
      <p className="mt-1 text-xs text-stone-500">Untick a location to hide this service from its booking page and staff pickers. Prices are the same everywhere.</p>
    </fieldset>
  );
}
