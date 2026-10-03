import { requireContext } from "@/server/context";
import { approvalQuery, listApprovals } from "@/server/approvals";
import { json, route } from "@/server/http";
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "form.read");
  return json(await listApprovals(ctx, approvalQuery.parse(Object.fromEntries(new URL(request.url).searchParams))));
});
