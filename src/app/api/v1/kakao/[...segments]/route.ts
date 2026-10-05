import { z } from "zod";
import { kakaoChannelInput, kakaoChannelPatch, kakaoPreviewInput, kakaoTemplateInput, kakaoTemplatePatch } from "@/contracts/kakao";
import { requireContext } from "@/server/context";
import { body, fail, json, route } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { createKakaoChannel, createKakaoTemplate, listKakaoChannels, listKakaoTemplates, previewKakaoTemplate, readKakaoReview, requestKakaoChannelVerification, sendKakaoTemplate, submitKakaoTemplate, updateKakaoChannel, updateKakaoTemplate } from "@/server/kakao";

const versionInput = z.object({ version: z.number().int().positive() }).strict();
function segments(request: Request) { return new URL(request.url).pathname.split("/").slice(4); }
export const GET = route(async request => {
  const ctx = await requireContext(request.headers, "message.manage");
  const [first, id, action] = segments(request);
  const serviceId = z.uuid().parse(new URL(request.url).searchParams.get("serviceId"));
  if (first === "channels" && !id) return json(await listKakaoChannels(ctx, serviceId));
  if (first === "templates" && !id) return json(await listKakaoTemplates(ctx, serviceId));
  if (first === "templates" && id && action === "review") return json(await readKakaoReview(ctx, z.uuid().parse(id)));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const POST = route(async (request, requestId) => {
  const [first, id, action] = segments(request);
  const ctx = await requireContext(request.headers, "message.manage");
  if (first === "channels" && !id) {
    const input = await body(request, kakaoChannelInput);
    const result = await idempotent("kakao-channel:" + ctx.tenantId, request.headers.get("idempotency-key"), input, async tx => {
      const row = await createKakaoChannel(tx, ctx, input, requestId);
      return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "kakao-channel" as const, resourceId: row.id } };
    });
    return json(result.body, result.status);
  }
  if (first === "channels" && id && action === "verify") return json(await requestKakaoChannelVerification(ctx, z.uuid().parse(id), requestId));
  if (first === "templates" && id === "preview") return json(previewKakaoTemplate(await body(request, kakaoPreviewInput)));
  if (first === "templates" && !id) {
    const input = await body(request, kakaoTemplateInput);
    const result = await idempotent("kakao-template:" + ctx.tenantId, request.headers.get("idempotency-key"), input, async tx => {
      const row = await createKakaoTemplate(tx, ctx, input, requestId);
      return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "kakao-template" as const, resourceId: row.id } };
    });
    return json(result.body, result.status);
  }
  if (first === "templates" && id && action === "submit") {
    const input = await body(request, versionInput);
    return json(await submitKakaoTemplate(ctx, z.uuid().parse(id), input.version, requestId));
  }
  if (first === "templates" && id && action === "send") return json(await sendKakaoTemplate(ctx, z.uuid().parse(id)));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
export const PATCH = route(async (request, requestId) => {
  const ctx = await requireContext(request.headers, "message.manage");
  const [first, id] = segments(request);
  if (first === "channels" && id) return json(await updateKakaoChannel(ctx, z.uuid().parse(id), await body(request, kakaoChannelPatch), requestId));
  if (first === "templates" && id) return json(await updateKakaoTemplate(ctx, z.uuid().parse(id), await body(request, kakaoTemplatePatch), requestId));
  fail(404, "NOT_FOUND", "경로를 찾을 수 없습니다.");
});
