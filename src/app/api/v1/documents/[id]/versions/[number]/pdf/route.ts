import { z } from "zod";
import { requireContext } from "@/server/context";
import { privateDocumentPdf } from "@/server/document-pdf";
import { pdfResponse } from "@/server/pdf-renderer";
import { rateLimit, route } from "@/server/http";
export const runtime = "nodejs";
export const GET = route(async (request, requestId) => {
  const parts = new URL(request.url).pathname.split("/"), id = z.uuid().parse(parts[4]), number = z.coerce.number().int().positive().parse(parts[6]);
  const ctx = await requireContext(request.headers, "document.read");
  await rateLimit("document-pdf:member:" + ctx.member.id, 30);
  return pdfResponse(await privateDocumentPdf(ctx, id, number, requestId));
});
