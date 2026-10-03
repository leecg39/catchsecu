import { z } from "zod";
import { requireContext } from "@/server/context";
import { privateConsentReceiptPdf } from "@/server/consent-receipts";
import { pdfResponse } from "@/server/pdf-renderer";
import { rateLimit, route } from "@/server/http";
export const runtime = "nodejs";
export const GET = route(async (request, requestId) => {
  const parts = new URL(request.url).pathname.split("/"), id = z.uuid().parse(parts[4]), receiptId = z.uuid().parse(parts[6]);
  const ctx = await requireContext(request.headers, "submission.read");
  await rateLimit("receipt-pdf:member:" + ctx.member.id, 30);
  return pdfResponse(await privateConsentReceiptPdf(ctx, id, receiptId, requestId));
});
