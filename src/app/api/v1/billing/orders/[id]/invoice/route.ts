import { z } from "zod";
import { requireContext } from "@/server/context";
import { route } from "@/server/http";
import { invoicePdf } from "@/server/billing-settlement";

export const GET = route(async request => {
  const id = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
  const invoice = await invoicePdf(await requireContext(request.headers, "billing.read"), id);
  return new Response(invoice.bytes as unknown as BodyInit, { status: 200, headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${invoice.name}"`,
    "x-content-sha256": invoice.hash,
  } });
});
