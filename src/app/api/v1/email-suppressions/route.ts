import { suppressionQuery } from "@/contracts/email-feedback";
import { requireContext } from "@/server/context";
import { json, route } from "@/server/http";
import { listEmailSuppressions } from "@/server/email-feedback";
export const GET = route(async (request, requestId) => json(await listEmailSuppressions(await requireContext(request.headers, "message.read"), suppressionQuery.parse(Object.fromEntries(new URL(request.url).searchParams)), requestId)));
