import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { KakaoChannel, KakaoTemplate } from "@/generated/prisma/client";
import { kakaoChannelInput, kakaoChannelPatch, kakaoPreviewInput, kakaoReviewInput, kakaoTemplateInput, kakaoTemplatePatch, kakaoVariables, type KakaoChannelRecord, type KakaoTemplateRecord } from "@/contracts/kakao";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { lockFormService } from "./form-access";

function channelDto(row: KakaoChannel): KakaoChannelRecord {
  return { id: row.id, serviceId: row.serviceId, name: row.name, searchId: row.searchId, status: row.status as KakaoChannelRecord["status"], version: row.version };
}
function templateDto(row: KakaoTemplate): KakaoTemplateRecord {
  return { id: row.id, serviceId: row.serviceId, channelId: row.channelId, name: row.name, body: row.body, buttons: row.buttons as KakaoTemplateRecord["buttons"], status: row.status as KakaoTemplateRecord["status"], reviewNote: row.reviewNote, version: row.version };
}
async function lockService(tx: Transaction, ctx: Context, serviceId: string) {
  return lockFormService(tx, ctx, serviceId, "message.manage");
}
export async function listKakaoChannels(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => {
    await lockService(tx, ctx, serviceId);
    const rows = await tx.kakaoChannel.findMany({ where: { tenantId: ctx.tenantId, serviceId }, orderBy: { createdAt: "asc" } });
    return { items: rows.map(channelDto) };
  });
}
export async function createKakaoChannel(tx: Transaction, ctx: Context, input: z.infer<typeof kakaoChannelInput>, requestId: string) {
  await lockService(tx, ctx, input.serviceId);
  if (await tx.kakaoChannel.findFirst({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, searchId: input.searchId } }))
    fail(409, "ALREADY_EXISTS", "이 서비스에 같은 카카오 채널이 있습니다.");
  const row = await tx.kakaoChannel.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, name: input.name, searchId: input.searchId } });
  await audit(tx, ctx, requestId, "kakao.channel_created", "kakaoChannel", row.id, ["name", "searchId"], input.serviceId);
  return channelDto(row);
}
export async function updateKakaoChannel(ctx: Context, id: string, input: z.infer<typeof kakaoChannelPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
    await lockService(tx, ctx, current.serviceId);
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (input.status === "archived" && await tx.kakaoTemplate.count({ where: { channelId: id, status: { not: "archived" } } }))
      fail(409, "CHANNEL_IN_USE", "사용 중인 템플릿이 있어 채널을 보관할 수 없습니다.");
    const row = await tx.kakaoChannel.update({ where: { id }, data: { name: input.name, searchId: input.searchId, status: input.status === "archived" ? "archived" : current.status === "verified" ? "verified" : "pending", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "kakao.channel_updated", "kakaoChannel", id, ["name", "searchId", "status"], current.serviceId);
    return channelDto(row);
  });
}
export async function requestKakaoChannelVerification(ctx: Context, id: string) {
  const row = await db.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
  await db.$transaction(tx => lockService(tx, ctx, row.serviceId));
  fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 채널 확인 공급자를 연결한 뒤에 인증할 수 있습니다.");
}
export async function listKakaoTemplates(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => {
    await lockService(tx, ctx, serviceId);
    const rows = await tx.kakaoTemplate.findMany({ where: { tenantId: ctx.tenantId, serviceId }, orderBy: { createdAt: "asc" } });
    return { items: rows.map(templateDto) };
  });
}
export async function createKakaoTemplate(tx: Transaction, ctx: Context, input: z.infer<typeof kakaoTemplateInput>, requestId: string) {
  await lockService(tx, ctx, input.serviceId);
  const channel = await tx.kakaoChannel.findFirst({ where: { id: input.channelId, tenantId: ctx.tenantId, serviceId: input.serviceId, status: { not: "archived" } } });
  if (!channel) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
  if (await tx.kakaoTemplate.findFirst({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, name: input.name } }))
    fail(409, "ALREADY_EXISTS", "이 서비스에 같은 이름의 템플릿이 있습니다.");
  const row = await tx.kakaoTemplate.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, channelId: channel.id, name: input.name, body: input.body, buttons: input.buttons } });
  await audit(tx, ctx, requestId, "kakao.template_created", "kakaoTemplate", row.id, ["name", "body"], input.serviceId);
  return templateDto(row);
}
export async function updateKakaoTemplate(ctx: Context, id: string, input: z.infer<typeof kakaoTemplatePatch>, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    await lockService(tx, ctx, current.serviceId);
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const row = await tx.kakaoTemplate.update({ where: { id }, data: { name: input.name, body: input.body, buttons: input.buttons, status: "draft", reviewNote: "", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "kakao.template_updated", "kakaoTemplate", id, ["name", "body", "status"], current.serviceId);
    return templateDto(row);
  });
}
export async function submitKakaoTemplate(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    await lockService(tx, ctx, current.serviceId);
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (!["draft", "rejected"].includes(current.status)) fail(409, "REVIEW_UNAVAILABLE", "초안이거나 반려된 템플릿만 심사 요청할 수 있습니다.");
    const row = await tx.kakaoTemplate.update({ where: { id }, data: { status: "submitted", reviewNote: "", version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "kakao.template_submitted", "kakaoTemplate", id, ["status"], current.serviceId);
    return templateDto(row);
  });
}
export async function readKakaoReview(ctx: Context, id: string) {
  const row = await db.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
  await db.$transaction(tx => lockService(tx, ctx, row.serviceId));
  return { id: row.id, status: row.status, reviewNote: row.reviewNote, providerMatched: false };
}
export function previewKakaoTemplate(input: z.infer<typeof kakaoPreviewInput>) {
  const names = kakaoVariables(input.body);
  const missing = names.filter(name => input.values[name] === undefined);
  if (missing.length) fail(422, "MISSING_VARIABLE", "템플릿 변수 값을 모두 입력해주세요.");
  const text = input.body.replaceAll(/#\{([A-Za-z0-9_]{1,30})\}/g, (_, name: string) => input.values[name]);
  return { text, buttons: input.buttons, stored: false };
}
export async function assertKakaoTemplateSendable(ctx: Context, id: string) {
  const row = await db.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { channel: true } });
  if (!row) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
  await db.$transaction(tx => lockService(tx, ctx, row.serviceId));
  if (row.status !== "approved" || row.channel.status !== "verified") fail(409, "TEMPLATE_NOT_APPROVED", "승인된 템플릿과 확인된 채널만 발송할 수 있습니다.");
  fail(503, "KAKAO_PROVIDER_REQUIRED", "알림톡 발송 공급자를 연결한 뒤에 발송할 수 있습니다.");
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function applyKakaoReview(raw: string, signature: string, secret: string | undefined, requestId: string = randomUUID()) {
  if (!secret) fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 심사 결과 비밀이 설정되지 않았습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "KAKAO_SIGNATURE_INVALID", "카카오 심사 서명을 확인할 수 없습니다.");
  const input = kakaoReviewInput.parse(JSON.parse(raw));
  return db.$transaction(async tx => {
    if (input.kind === "channel") {
      if (input.outcome !== "verified") fail(422, "INVALID_REVIEW", "채널 결과는 확인만 받을 수 있습니다.");
      const row = await tx.kakaoChannel.findUnique({ where: { id: input.id } });
      if (!row || row.status === "archived") fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
      const saved = await tx.kakaoChannel.update({ where: { id: row.id }, data: { status: "verified", version: { increment: 1 } } });
      await audit(tx, { tenantId: row.tenantId, user: { id: null } }, requestId, "kakao.channel_verified", "kakaoChannel", row.id, ["status"], row.serviceId);
      return channelDto(saved);
    }
    if (input.outcome === "verified") fail(422, "INVALID_REVIEW", "템플릿은 승인 또는 반려만 받을 수 있습니다.");
    const row = await tx.kakaoTemplate.findUnique({ where: { id: input.id } });
    if (!row || row.status !== "submitted") fail(409, "REVIEW_UNAVAILABLE", "심사 요청 중인 템플릿만 결과를 반영할 수 있습니다.");
    const saved = await tx.kakaoTemplate.update({ where: { id: row.id }, data: { status: input.outcome === "approved" ? "approved" : "rejected", reviewNote: input.note, version: { increment: 1 } } });
    await audit(tx, { tenantId: row.tenantId, user: { id: null } }, requestId, "kakao.template_" + input.outcome, "kakaoTemplate", row.id, ["status", "reviewNote"], row.serviceId);
    return templateDto(saved);
  });
}
