import { readBody, route } from "@/lib/api";
import { addBarcodeApi, barcodeBody, guarded, listBarcodesApi } from "@/server/api-v1-catalog";

/** GET /api/v1/products/:id/barcodes: the extra barcodes (a case, another pack size). The main barcode is on the product itself. */
export const GET = route<{ id: string }>("catalog:read", async (ctx, _req, { id }) => listBarcodesApi(ctx.business.id, id));

/** POST /api/v1/products/:id/barcodes: { code, units_per_scan? }. A code can belong to one product only (409). */
export const POST = route<{ id: string }>("catalog:write", async (ctx, req, { id }) => {
  const body = await readBody(req, barcodeBody);
  if ("error" in body) return body.error;
  return guarded(() => addBarcodeApi(ctx, id, body.data));
});
