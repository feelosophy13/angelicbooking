import { X } from "lucide-react";
import { Card, Checkbox, Input, Button } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { Disclosure } from "@/components/disclosure";
import { PhotoAdd } from "@/components/photo-add";
import { pairKey, type PhotoPair, type PhotoRow } from "@/lib/visit-photos";
import { addPhotos, removePhoto, savePairDetails } from "./photo-actions";

export type PhotoGroup = { serviceId: string | null; staffId: string | null; serviceName: string; staffName: string };

function Strip({ slug, appointmentId, label, photos, fields }: { slug: string; appointmentId: string; label: "Before" | "After"; photos: PhotoRow[]; fields: Record<string, string> }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            <a href={`/api/files/${p.fileId}`} target="_blank" rel="noreferrer" aria-label={`Open ${label.toLowerCase()} photo`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${p.thumbFileId ?? p.fileId}`} alt={`${label} photo`} loading="lazy" className="h-24 w-24 rounded-lg bg-stone-100 object-cover" />
            </a>
            <form action={removePhoto} className="absolute -right-2 -top-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="appointmentId" value={appointmentId} />
              <input type="hidden" name="photoId" value={p.id} />
              <ConfirmSubmit title="Remove this photo?" body="It is deleted for good." confirmLabel="Remove" variant="ghost" className="!h-6 !w-6 !rounded-full !border !border-stone-200 !bg-white !p-0 text-stone-600 shadow-sm hover:!border-red-300 hover:!bg-red-50 hover:text-red-700">
                <X className="h-3.5 w-3.5" aria-label="Remove photo" />
              </ConfirmSubmit>
            </form>
          </div>
        ))}
        <PhotoAdd action={addPhotos} fields={{ ...fields, phase: label.toLowerCase() }} label={`Add ${label.toLowerCase()} photos`} />
      </div>
    </div>
  );
}

/** Before and after photos for each service on the visit. Added right here, from a phone or the front-desk computer. */
export function VisitPhotosCard({ slug, appointmentId, groups, pairs, tagSuggestions }: { slug: string; appointmentId: string; groups: PhotoGroup[]; pairs: PhotoPair[]; tagSuggestions: string[] }) {
  if (groups.length === 0) return null;
  const byKey = new Map(pairs.map((p) => [p.key, p]));
  const listId = `photo-tags-${appointmentId}`;
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Photos</h2>
      <p className="mb-3 text-xs text-stone-500">Before and after, kept private to your team and found again in the Gallery.</p>
      <div className="space-y-5">
        {groups.map((g) => {
          const key = pairKey({ appointmentId, serviceId: g.serviceId, staffId: g.staffId });
          const pair = byKey.get(key);
          const fields = { slug, appointmentId, serviceId: g.serviceId ?? "", staffId: g.staffId ?? "" };
          return (
            <div key={key} className="space-y-3">
              {groups.length > 1 || pair ? <p className="text-sm font-medium text-stone-800">{g.serviceName} <span className="font-normal text-stone-500">· {g.staffName}</span></p> : null}
              <div className="space-y-4">
                <Strip slug={slug} appointmentId={appointmentId} label="Before" photos={pair?.before ?? []} fields={fields} />
                <Strip slug={slug} appointmentId={appointmentId} label="After" photos={pair?.after ?? []} fields={fields} />
              </div>
              {pair ? (
                <Disclosure title="Tags and sharing" hint={pair.tags.length ? pair.tags.map((t) => `#${t}`).join(" ") : "none yet"} className="shadow-none">
                  <form action={savePairDetails} className="space-y-3">
                    {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-stone-700" htmlFor={`tags-${key}`}>Tags</label>
                      <Input id={`tags-${key}`} name="tags" list={listId} defaultValue={pair.tags.join(", ")} placeholder="balayage, blonde, bridal" />
                      <p className="mt-1 text-xs text-stone-500">Separate with commas. Used to filter the Gallery.</p>
                    </div>
                    <Checkbox name="shareOk" defaultChecked={pair.shareOk} label="The client agreed we can show these photos publicly" hint="For your portfolio or social media. Never shown anywhere automatically." />
                    <Button type="submit" size="sm" variant="secondary">Save</Button>
                  </form>
                </Disclosure>
              ) : null}
            </div>
          );
        })}
      </div>
      <datalist id={listId}>{tagSuggestions.map((t) => <option key={t} value={t} />)}</datalist>
    </Card>
  );
}
