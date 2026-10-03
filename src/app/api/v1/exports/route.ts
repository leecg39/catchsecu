import { createExportInput, exportListQuery } from "@/contracts/exports";
import { requireContext } from "@/server/context";
import { body, json, route } from "@/server/http";
import { createExport, listExports } from "@/server/exports";

export const POST = route(async (request, requestId) => json(await createExport(await requireContext(request.headers, "submission.read"), await body(request, createExportInput), request.headers.get("idempotency-key"), requestId), 201));
export const GET = route(async request => json(await listExports(await requireContext(request.headers, "submission.read"), exportListQuery.parse(Object.fromEntries(new URL(request.url).searchParams)))));
