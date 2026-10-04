import { complianceExportInput, complianceExportList } from "@/contracts/compliance-exports";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createComplianceExport, listComplianceExports } from "@/server/compliance-exports";
import { requestQuery } from "@/server/request-query";
export const POST = route(async (request, requestId) => json(await createComplianceExport(await requireContext(request.headers, "service.read"), await body(request, complianceExportInput), request.headers.get("idempotency-key"), requestId), 202));
export const GET = route(async request => json(await listComplianceExports(await requireContext(request.headers, "service.read"), complianceExportList.parse(requestQuery(request)))));
