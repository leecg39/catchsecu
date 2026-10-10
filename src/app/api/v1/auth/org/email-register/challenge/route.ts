import { orgEmailChallengeBody } from "@/contracts/sso";
import { body } from "@/server/http";
import { ssoRoute } from "@/server/sso-route";
import { requestOrgEmailChallenge } from "@/server/org-auth";

export const POST = ssoRoute(async request => Response.json(
  await requestOrgEmailChallenge(await body(request, orgEmailChallengeBody), request.headers),
  { headers: { "Cache-Control": "private, no-store" } },
));
