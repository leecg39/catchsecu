import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { limitedEmailBody } from "@/server/email-feedback";
import { applyKakaoReceipt } from "@/server/kakao-adapter";

export const POST = route(async request => {
  const raw = await limitedEmailBody(request);
  const signature = request.headers.get("x-kakao-signature") ?? "";
  return json(await applyKakaoReceipt(raw.toString("utf8"), signature, env.KAKAO_WEBHOOK_SECRET), 202);
}, "signed-webhook");
