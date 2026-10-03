import { suppressionQuery } from "@/contracts/email-feedback";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { listEmailSuppressions } from "@/server/email-feedback";
import { requestQuery } from "@/server/request-query";
export const GET = route(async (request, requestId) => json(await listEmailSuppressions(await requireContext(request.headers, "message.read"), suppressionQuery.parse(requestQuery(request)), requestId)));
