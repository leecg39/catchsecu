import { z } from "zod";
import { requireContext } from "@/server/context";
import { json, listQuery, route } from "@/server/http";
import { listSubmissionFiles } from "@/server/file-download";
export const GET = route(async (request, requestId) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = listQuery.parse(params), submissionId = z.uuid().parse(params.submissionId);
  return json(await listSubmissionFiles(await requireContext(request.headers, "file.read"), submissionId, query.page, query.pageSize, requestId));
});
