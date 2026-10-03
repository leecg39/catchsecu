import { publicDocumentPdf } from "@/server/document-pdf";
import { pdfResponse } from "@/server/pdf-renderer";
import { tokenHash } from "@/server/crypto";
import { rateLimit, route } from "@/server/http";
export const runtime = "nodejs";
export const GET = route(async request => {
  const token = new URL(request.url).pathname.split("/").at(-2) ?? "";
  await rateLimit("document-pdf:token:" + tokenHash(token), 30);
  return pdfResponse(await publicDocumentPdf(token));
});
