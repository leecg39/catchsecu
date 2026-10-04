import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { limitedEmailBody } from "@/server/email-feedback";
import { applyKakaoReview } from "@/server/kakao";

export const POST = route(async (request, requestId) => {
  const raw = await limitedEmailBody(request);
  return json(await applyKakaoReview(raw.toString("utf8"), request.headers.get("x-kakao-signature") ?? "", env.KAKAO_REVIEW_SECRET, requestId), 202);
}, "signed-webhook");
