import { and, asc, desc, eq, gte, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { deleteFileById, FileError, storeVisitPhoto } from "@/lib/files";
import { listCategories, subtreeIds } from "./categories";
import { buildPairs, parseTags, pairKey, type GalleryFilters, type PhotoPair, type PhotoQueryRow, type Phase } from "@/lib/visit-photos";

const vp = schema.visitPhotos;
export const GALLERY_PAGE_SIZE = 24;
const MAX_PER_UPLOAD = 12;

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

const sameOrNull = (col: typeof vp.serviceId | typeof vp.staffId, v: string | null) => (v ? eq(col, v) : isNull(col));

async function audit(tx: Tx, businessId: string, actorUserId: string, action: string, appointmentId: string, diff: unknown) {
  await tx.insert(schema.auditLog).values({ businessId, actorUserId, action, entity: "appointment", entityId: appointmentId, diff: JSON.stringify(diff) });
}

/** Add one or more photos to a pair (an appointment's service by one stylist). New photos take the pair's tags and consent. */
export async function addVisitPhotos(input: { businessId: string; appointmentId: string; serviceId: string | null; staffId: string | null; phase: Phase; files: File[]; actorUserId: string }) {
  const files = input.files.filter((f) => f && f.size > 0);
  if (files.length === 0) throw new FileError("Choose at least one photo.");
  if (files.length > MAX_PER_UPLOAD) throw new FileError(`Add up to ${MAX_PER_UPLOAD} photos at a time.`);
  const base = await withTenant(input.businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId), columns: { id: true, clientId: true } });
    if (!appt) throw new FileError("That appointment no longer exists.");
    const items = await tx.select({ serviceId: schema.appointmentItems.serviceId, staffId: schema.appointmentItems.staffId }).from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appt.id));
    if (!items.some((i) => i.serviceId === input.serviceId && i.staffId === input.staffId)) throw new FileError("Pick one of the services on this visit.");
    const [existing] = await tx.select({ tags: vp.tags, shareOk: vp.shareOk }).from(vp).where(and(eq(vp.appointmentId, appt.id), sameOrNull(vp.serviceId, input.serviceId), sameOrNull(vp.staffId, input.staffId))).limit(1);
    return { clientId: appt.clientId, tags: existing?.tags ?? [], shareOk: existing?.shareOk ?? false };
  });
  // Resizing is the slow part, so it happens outside the transaction; a failure undoes what was stored so far.
  const stored: { fileId: string; thumbFileId: string }[] = [];
  const cleanup = async () => { for (const s of stored) { await deleteFileById(s.fileId); await deleteFileById(s.thumbFileId); } };
  try {
    for (const f of files) stored.push(await storeVisitPhoto(input.businessId, f));
    await withTenant(input.businessId, async (tx) => {
      await tx.insert(vp).values(stored.map((s) => ({ businessId: input.businessId, appointmentId: input.appointmentId, clientId: base.clientId, serviceId: input.serviceId, staffId: input.staffId, phase: input.phase, fileId: s.fileId, thumbFileId: s.thumbFileId, tags: base.tags, shareOk: base.shareOk, createdByUserId: input.actorUserId })));
      await audit(tx, input.businessId, input.actorUserId, "appointment.photo_add", input.appointmentId, { phase: input.phase, count: stored.length });
    });
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Tags and public-sharing consent are the same for every photo of a pair. */
export async function setPairDetails(input: { businessId: string; appointmentId: string; serviceId: string | null; staffId: string | null; tags: string[]; shareOk: boolean; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    await tx.update(vp).set({ tags: input.tags, shareOk: input.shareOk }).where(and(eq(vp.appointmentId, input.appointmentId), sameOrNull(vp.serviceId, input.serviceId), sameOrNull(vp.staffId, input.staffId)));
    await audit(tx, input.businessId, input.actorUserId, "appointment.photo_details", input.appointmentId, { tags: input.tags, shareOk: input.shareOk });
  });
}

export async function removeVisitPhoto(input: { businessId: string; photoId: string; actorUserId: string }) {
  const row = await withTenant(input.businessId, async (tx) => {
    const [r] = await tx.select().from(vp).where(eq(vp.id, input.photoId)).limit(1);
    if (!r) return null;
    await tx.delete(vp).where(eq(vp.id, r.id));
    await audit(tx, input.businessId, input.actorUserId, "appointment.photo_remove", r.appointmentId, { phase: r.phase });
    return r;
  });
  if (!row) return;
  await deleteFileById(row.fileId);
  await deleteFileById(row.thumbFileId);
}

async function photoRows(tx: Tx, where: SQL | undefined): Promise<PhotoQueryRow[]> {
  const rows = await tx
    .select({
      id: vp.id, appointmentId: vp.appointmentId, clientId: vp.clientId, serviceId: vp.serviceId, staffId: vp.staffId, phase: vp.phase, fileId: vp.fileId, thumbFileId: vp.thumbFileId,
      tags: vp.tags, shareOk: vp.shareOk, takenAt: vp.takenAt, serviceName: schema.services.name, staffName: schema.staff.displayName,
      firstName: schema.clients.firstName, lastName: schema.clients.lastName, locationId: schema.appointments.locationId,
    })
    .from(vp)
    .innerJoin(schema.appointments, eq(schema.appointments.id, vp.appointmentId))
    .leftJoin(schema.services, eq(schema.services.id, vp.serviceId))
    .leftJoin(schema.staff, eq(schema.staff.id, vp.staffId))
    .leftJoin(schema.clients, eq(schema.clients.id, vp.clientId))
    .where(where)
    .orderBy(asc(vp.takenAt), asc(vp.createdAt));
  return rows.map((r) => ({ ...r, phase: r.phase === "after" ? "after" : "before" }));
}

/** Every pair on one appointment, for its Photos card. */
export async function pairsForAppointment(businessId: string, appointmentId: string): Promise<PhotoPair[]> {
  return withTenant(businessId, async (tx) => buildPairs(await photoRows(tx, eq(vp.appointmentId, appointmentId))));
}

/** Distinct tags already in use, for suggestions and the Gallery's tag filter. */
export async function photoTagsInUse(businessId: string): Promise<string[]> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.execute(sql`select distinct unnest(tags) as tag from visit_photos order by 1`);
    return Array.from(rows as unknown as { tag: string }[]).map((r) => r.tag);
  });
}

/** The Gallery: pairs newest first, narrowed by the filters. Fetches one extra pair to know whether there is a next page. */
export async function listGallery(businessId: string, f: GalleryFilters, pageSize = GALLERY_PAGE_SIZE): Promise<{ pairs: PhotoPair[]; hasMore: boolean }> {
  const conds: (SQL | undefined)[] = [];
  if (f.serviceId) conds.push(eq(vp.serviceId, f.serviceId));
  if (f.categoryId) {
    const ids = subtreeIds(await listCategories(businessId, "service"), f.categoryId);
    conds.push(inArray(vp.serviceId, sql`(select id from services where category_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`));
  }
  if (f.staffId) conds.push(eq(vp.staffId, f.staffId));
  if (f.clientId) conds.push(eq(vp.clientId, f.clientId));
  if (f.locationId) conds.push(eq(schema.appointments.locationId, f.locationId));
  if (f.tag) conds.push(sql`${f.tag} = any(${vp.tags})`);
  if (f.periodDays) conds.push(gte(vp.takenAt, new Date(Date.now() - f.periodDays * 86_400_000)));
  if (f.q) conds.push(ilike(sql`${schema.clients.firstName} || ' ' || ${schema.clients.lastName}`, `%${f.q.replace(/[%_\\]/g, "\\$&")}%`));
  const having: SQL[] = [];
  if (f.bothOnly) having.push(sql`count(distinct ${vp.phase}) = 2`);
  if (f.shareableOnly) having.push(sql`bool_and(${vp.shareOk})`);
  return withTenant(businessId, async (tx) => {
    const groups = await tx
      .select({ appointmentId: vp.appointmentId, serviceId: vp.serviceId, staffId: vp.staffId })
      .from(vp)
      .innerJoin(schema.appointments, eq(schema.appointments.id, vp.appointmentId))
      .leftJoin(schema.clients, eq(schema.clients.id, vp.clientId))
      .where(and(...conds))
      .groupBy(vp.appointmentId, vp.serviceId, vp.staffId)
      .having(having.length ? and(...having) : undefined)
      .orderBy(desc(sql`max(${vp.takenAt})`), desc(vp.appointmentId))
      .limit(pageSize + 1)
      .offset((f.page - 1) * pageSize);
    const hasMore = groups.length > pageSize;
    const page = groups.slice(0, pageSize);
    if (page.length === 0) return { pairs: [], hasMore: false };
    const rows = await photoRows(tx, inArray(vp.appointmentId, [...new Set(page.map((g) => g.appointmentId))]));
    return { pairs: buildPairs(rows, page.map(pairKey)), hasMore };
  });
}

/** Services that have at least one photo, so the Gallery's service filter lists only what can match. */
export async function photoServiceIds(businessId: string): Promise<Set<string>> {
  return withTenant(businessId, async (tx) => {
    const rows = await tx.selectDistinct({ id: vp.serviceId }).from(vp);
    return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
  });
}
