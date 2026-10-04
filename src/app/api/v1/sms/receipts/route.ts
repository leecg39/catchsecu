import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { limitedEmailBody } from "@/server/email-feedback";
import { applySmsReceipt } from "@/server/sms-adapter";

export const POST = route(async request => {
  const raw = await limitedEmailBody(request);
  const signature = request.headers.get("x-sms-signature") ?? "";
  return json(await applySmsReceipt(raw.toString("utf8"), signature, env.SMS_WEBHOOK_SECRET), 202);
}, "signed-webhook");