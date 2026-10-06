import { ssoInvitationToken } from "@/contracts/sso";
import { body, json } from "@/server/http";
import { ssoInvitationOptions } from "@/server/sso";
import { ssoRoute } from "@/server/sso-route";

export const POST = ssoRoute(async request => {
  const input = await body(request, ssoInvitationToken);
  return json(await ssoInvitationOptions(input.token, request.headers));
});
