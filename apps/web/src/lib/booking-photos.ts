/**
 * Pure rules for the photos a client attaches when booking online: how many, how the posted files are read, and how the ones that
 * could not be used travel to the confirmation page. The storing itself is server/visit-photos.ts (addClientPhotos).
 */

/** Pictures per booking. Enough for inspiration and a "this is me now"; more would slow the booking down on a phone. */
export const MAX_BOOKING_PHOTOS = 5;

/** The form's `photos` field name (several files under one name). */
export const PHOTOS_FIELD = "photos";

/** The files a client attached, in order, empty entries skipped, never more than the cap. */
export function bookingPhotosFrom(formData: FormData | null | undefined): File[] {
  if (!formData) return [];
  return formData
    .getAll(PHOTOS_FIELD)
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0)
    .slice(0, MAX_BOOKING_PHOTOS);
}

export type DroppedPhoto = { name: string; reason: string };

/** A short, safe name for a dropped picture ("IMG_4021.HEIC"), for the confirmation page and the address that carries it. */
export const shortName = (name: string) => (name || "photo").replace(/[^\w.\- ()]/g, "").slice(0, 40) || "photo";

/** Query-string value for the confirmation page: the dropped names, "|"-separated. */
export const droppedParam = (dropped: DroppedPhoto[]) => (dropped.length ? dropped.map((d) => shortName(d.name)).join("|") : null);
export const parseDropped = (raw: string | string[] | undefined): string[] => (typeof raw === "string" && raw ? raw.split("|").map(shortName).filter(Boolean).slice(0, MAX_BOOKING_PHOTOS) : []);

/** "2 photos from client" for the calendar hover card; null when there are none. */
export const clientPhotosFact = (n: number | null | undefined) => (n && n > 0 ? `${n} photo${n === 1 ? "" : "s"} from client` : null);
