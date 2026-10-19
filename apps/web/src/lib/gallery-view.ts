import type { PhotoPair } from "./visit-photos";
import type { PairView } from "@/components/photo-pair";

/** What a pair card needs, with the date already written out in the business's time zone. */
export function pairViews(slug: string, pairs: PhotoPair[], timeZone: string): PairView[] {
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone });
  return pairs.map((p) => ({
    key: p.key,
    appointmentHref: `/app/${slug}/appointments/${p.appointmentId}`,
    clientName: p.clientName,
    clientHref: p.clientId ? `/app/${slug}/clients/${p.clientId}` : null,
    serviceName: p.serviceName,
    staffName: p.staffName,
    dateLabel: fmt.format(p.takenAt),
    tags: p.tags,
    shareOk: p.shareOk,
    before: p.before.map(({ id, fileId, thumbFileId }) => ({ id, fileId, thumbFileId })),
    after: p.after.map(({ id, fileId, thumbFileId }) => ({ id, fileId, thumbFileId })),
    fromClient: p.fromClient.map(({ id, fileId, thumbFileId }) => ({ id, fileId, thumbFileId })),
  }));
}
