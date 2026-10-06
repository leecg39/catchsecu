import { ssoInvitationStart } from "@/contracts/sso";
import { body, json } from "@/server/http";
import { startSso } from "@/server/sso";
import { ssoRoute } from "@/server/sso-route";

export const POST = ssoRoute(async request => {
  const input = await body(request, ssoInvitationStart);
  return json(await startSso(input.providerId, "invite", request.headers, input.token));
});
