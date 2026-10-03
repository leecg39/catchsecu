import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { fileListQuery } from "@/server/file-query";
import { listSubmissionFiles } from "@/server/file-download";
export const GET = route(async (request, requestId) => {
  const { submissionId, ...query } = fileListQuery(new URL(request.url));
  return json(await listSubmissionFiles(await requireContext(request.headers, "file.read"), submissionId, query.page, query.pageSize, requestId));
});
