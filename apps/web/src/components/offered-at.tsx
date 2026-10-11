import { Checkbox } from "@/components/ui";
/**
 * Location tick boxes for a catalogue item; renders nothing for a single-location business.
 * Posts loc_<id> for each ticked location plus hasLocations=1 so the action knows the boxes were shown.
 * None or all ticked = everywhere.
 */
export function OfferedAt({ locations, selected, legend = "Offered at", hint = "Untick a location to hide this service from its booking page and staff pickers. Prices are the same everywhere." }: { locations: { id: string; name: string }[]; selected: string[]; legend?: string; hint?: string }) {
  if (locations.length < 2) return null;
  const all = selected.length === 0;
  return (
    <fieldset className="rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-sm font-medium text-stone-700">{legend}</legend>
      <input type="hidden" name="hasLocations" value="1" />
      <div className="flex flex-wrap gap-4">
        {locations.map((l) => (
          <Checkbox key={l.id} name={`loc_${l.id}`} defaultChecked={all || selected.includes(l.id)} label={l.name} />
        ))}
      </div>
      <p className="mt-1 text-xs text-stone-500">{hint}</p>
    </fieldset>
  );
}

/** "Valid at" variant for gift cards, packages and memberships. */
export function ValidAt({ locations, selected, what }: { locations: { id: string; name: string }[]; selected?: string[]; what: string }) {
  return <OfferedAt locations={locations} selected={selected ?? []} legend="Valid at" hint={`Where ${what} can be redeemed. Leave every box ticked for any location.`} />;
}
