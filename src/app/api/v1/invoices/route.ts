import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { listInvoices } from "@/server/billing-reads";

export const GET = route(async request =>
  json(await listInvoices(await requireContext(request.headers, "billing.read"), Object.fromEntries(new URL(request.url).searchParams))));
