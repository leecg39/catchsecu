import { z } from "zod";
import { messageContent } from "@/contracts/message-content";
import { requireContext } from "@/server/context";
import { body, json, rateLimit, route } from "@/server/http";
import { db } from "@/server/db";
import { campaignScope } from "@/server/campaign-common";
import { normalizeMessageContent, renderMessageContent } from "@/server/message-content";
const input = z.object({ serviceId: z.uuid(), channel: z.enum(["email", "sms"]), content: messageContent }).strict();
export const POST = route(async request => {
  const ctx = await requireContext(request.headers, "message.manage"), value = await body(request, input);
  await rateLimit("message-content:preview:" + ctx.member.id, 30);
  return db.$transaction(async tx => {
    await campaignScope(tx, ctx, value.serviceId, ["message.manage"], false);
    const content = normalizeMessageContent(value.content, value.channel);
    return json({ content, sample: renderMessageContent(content, { name: "예시 수신자", contact: value.channel === "email" ? "recipient@example.com" : "+821000000000" }), sanitized: JSON.stringify(value.content) !== JSON.stringify(content) });
  });
});
