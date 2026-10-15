import { route } from "@/lib/api";
import { deleteBarcodeApi } from "@/server/api-v1-catalog";

/** DELETE /api/v1/products/:id/barcodes/:barcodeId: remove an extra barcode. */
export const DELETE = route<{ id: string; barcodeId: string }>("catalog:write", async (ctx, _req, { id, barcodeId }) => deleteBarcodeApi(ctx, id, barcodeId));
