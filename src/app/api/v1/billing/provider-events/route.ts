import { env } from "@/server/env";
import { json, route } from "@/server/http";
import { limitedEmailBody } from "@/server/email-feedback";
import { applyPaymentEvent } from "@/server/payments";

export const POST = route(async (request, requestId) => {
  const raw = await limitedEmailBody(request);
  return json(await applyPaymentEvent(raw.toString("utf8"), request.headers.get("x-payment-signature") ?? "", env.PAYMENT_WEBHOOK_SECRET, requestId), 202);
}, "signed-webhook");
