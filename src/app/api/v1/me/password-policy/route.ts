import { body, json, route } from "@/server/http";
import { myPasswordPolicy, deferPassword } from "@/server/password-deferral";
import { passwordDeferralInput } from "@/contracts/security";
export const GET = route(async request => json(await myPasswordPolicy(request.headers)));
export const POST = route(async (request, requestId) => json(await deferPassword(request.headers, await body(request, passwordDeferralInput), requestId)));
