"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui";
import { ServiceCheckboxes } from "@/components/service-checkboxes";
import type { ServiceTreeNode } from "@/server/service-groups";

/** "Every client" or a set of services: the service list appears only when the form is not for everyone. */
export function WhoCompletes({ tree, applyToAll, serviceIds }: { tree: ServiceTreeNode[]; applyToAll: boolean; serviceIds: string[] }) {
  const [all, setAll] = useState(applyToAll);
  return (
    <fieldset className="rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-sm font-medium text-stone-700">Who has to complete it</legend>
      <Checkbox name="applyToAll" checked={all} onChange={(e) => setAll(e.target.checked)} label="Every client, before any visit" />
      {all ? (
        serviceIds.map((id) => <input key={id} type="hidden" name="serviceIds" value={id} />)
      ) : (
        <>
          <p className="mb-1 mt-2 text-xs text-stone-500">Only before these services:</p>
          <ServiceCheckboxes name="serviceIds" tree={tree} selected={serviceIds} />
        </>
      )}
    </fieldset>
  );
}
