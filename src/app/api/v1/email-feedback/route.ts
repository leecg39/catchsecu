import { json, route } from "@/server/http";
import { acceptEmailRelay } from "@/server/email-feedback";
export const POST = route(async (request, requestId) => json(await acceptEmailRelay(request, requestId), 202), "signed-webhook");
