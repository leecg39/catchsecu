import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { KakaoChannel, KakaoTemplate } from "@/generated/prisma/client";
import { kakaoChannelInput, kakaoChannelPatch, kakaoPreviewInput, kakaoReviewInput, kakaoTemplateInput, kakaoTemplatePatch, kakaoVariables, type KakaoChannelRecord, type KakaoTemplateRecord, type KakaoMockDelivery } from "@/contracts/kakao";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { env } from "./env";
import { fail } from "./http";
import { audit } from "./audit";
import { lockServiceActor } from "./service-actor";
import { idempotent } from "./idempotency";
import { tokenHash } from "./crypto";
import { assertFileDeadlines } from "./file-access";

function channelDto(row: KakaoChannel): KakaoChannelRecord {
  return { id: row.id, serviceId: row.serviceId, name: row.name, searchId: row.searchId, status: row.status as KakaoChannelRecord["status"], version: row.version };
}
function templateDto(row: KakaoTemplate): KakaoTemplateRecord {
  return { id: row.id, serviceId: row.serviceId, channelId: row.channelId, name: row.name, body: row.body, buttons: row.buttons as KakaoTemplateRecord["buttons"], status: row.status as KakaoTemplateRecord["status"], reviewNote: row.reviewNote, version: row.version };
}
async function lockService(tx: Transaction, ctx: Context, serviceId: string) {
  const actor = await lockServiceActor(tx, ctx, "message.manage");
  const service = await tx.service.findFirst({ where: { AND: [actor.scope, { id: serviceId }] } });
  if (!service) {
    if (!await tx.service.count({ where: { id: serviceId, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스의 알림톡을 관리할 수 없습니다.");
  return actor.deadlines;
}
export async function listKakaoChannels(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    const rows = await tx.kakaoChannel.findMany({ where: { tenantId: ctx.tenantId, serviceId }, orderBy: { createdAt: "asc" } });
    assertFileDeadlines(deadlines);
    return { items: rows.map(channelDto) };
  });
}
export async function createKakaoChannel(tx: Transaction, ctx: Context, input: z.infer<typeof kakaoChannelInput>, requestId: string) {
  const deadlines = await lockService(tx, ctx, input.serviceId);
  if (await tx.kakaoChannel.findFirst({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, searchId: input.searchId } }))
    fail(409, "ALREADY_EXISTS", "이 서비스에 같은 카카오 채널이 있습니다.");
  const row = await tx.kakaoChannel.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, name: input.name, searchId: input.searchId } });
  await audit(tx, ctx, requestId, "kakao.channel_created", "kakaoChannel", row.id, ["name", "searchId"], input.serviceId);
  assertFileDeadlines(deadlines);
  return channelDto(row);
}
async function lockChannel(tx: Transaction, tenantId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "KakaoChannel" WHERE id=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
  const row = await tx.kakaoChannel.findFirst({ where: { id, tenantId } });
  if (!row) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
  return row;
}
export async function updateKakaoChannel(ctx: Context, id: string, input: z.infer<typeof kakaoChannelPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const initial = await tx.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!initial) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, initial.serviceId);
    const current = await lockChannel(tx, ctx.tenantId, id);
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (input.status === "archived" && await tx.kakaoTemplate.count({ where: { channelId: id, status: { not: "archived" } } }))
      fail(409, "CHANNEL_IN_USE", "사용 중인 템플릿이 있어 채널을 보관할 수 없습니다.");
    const row = await tx.kakaoChannel.update({ where: { id }, data: { name: input.name, searchId: input.searchId, status: input.status === "archived" ? "archived" : current.status === "verified" && current.searchId === input.searchId ? "verified" : "pending", version: { increment: 1 } } });
    if (current.searchId !== input.searchId) {
      const templates = await tx.kakaoTemplate.findMany({ where: { tenantId: ctx.tenantId, channelId: id, status: { not: "archived" } }, select: { id: true } });
      for (const template of templates) {
        const reset = await tx.kakaoTemplate.updateMany({ where: { id: template.id, tenantId: ctx.tenantId, status: { not: "archived" } }, data: { status: "draft", reviewNote: "", version: { increment: 1 } } });
        if (reset.count) await audit(tx, ctx, requestId, "kakao.template_review_reset", "kakaoTemplate", template.id, ["status", "reviewNote"], current.serviceId);
      }
    }
    await audit(tx, ctx, requestId, "kakao.channel_updated", "kakaoChannel", id, ["name", "searchId", "status"], current.serviceId);
    assertFileDeadlines(deadlines);
    return channelDto(row);
  });
}
const LOCAL_REVIEW_SECRET = "local-kakao-review-secret-000000000000";
// 로컬 공급자는 심사 콜백을 내부에서 서명해 실제 webhook 경로(applyKakaoReview)를 그대로 통과시킨다.
async function localReview(input: z.infer<typeof kakaoReviewInput>, requestId: string, tx: Transaction) {
  const raw = JSON.stringify(input), secret = env.KAKAO_REVIEW_SECRET ?? LOCAL_REVIEW_SECRET;
  return applyKakaoReview(raw, createHmac("sha256", secret).update(raw).digest("hex"), secret, requestId, tx);
}
export async function requestKakaoChannelVerification(ctx: Context, id: string, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const initial = await tx.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!initial) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, initial.serviceId);
    const row = await lockChannel(tx, ctx.tenantId, id);
    if (env.KAKAO_PROVIDER !== "local") fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 채널 확인 공급자를 연결한 뒤에 인증할 수 있습니다.");
    if (row.status === "archived") fail(409, "CHANNEL_ARCHIVED", "보관된 채널은 인증할 수 없습니다.");
    if (row.status === "verified") fail(409, "ALREADY_VERIFIED", "이미 확인된 채널입니다.");
    const result = await localReview({ kind: "channel", id, version: row.version, outcome: "verified", note: "로컬 공급자 확인" }, requestId, tx);
    assertFileDeadlines(deadlines);
    return result;
  });
}
export async function listKakaoTemplates(ctx: Context, serviceId: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    const rows = await tx.kakaoTemplate.findMany({ where: { tenantId: ctx.tenantId, serviceId }, orderBy: { createdAt: "asc" } });
    assertFileDeadlines(deadlines);
    return { items: rows.map(templateDto) };
  });
}
export async function createKakaoTemplate(tx: Transaction, ctx: Context, input: z.infer<typeof kakaoTemplateInput>, requestId: string) {
  const deadlines = await lockService(tx, ctx, input.serviceId);
  const channel = await lockChannel(tx, ctx.tenantId, input.channelId);
  if (channel.serviceId !== input.serviceId || channel.status === "archived") fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
  if (await tx.kakaoTemplate.findFirst({ where: { tenantId: ctx.tenantId, serviceId: input.serviceId, name: input.name } }))
    fail(409, "ALREADY_EXISTS", "이 서비스에 같은 이름의 템플릿이 있습니다.");
  const row = await tx.kakaoTemplate.create({ data: { tenantId: ctx.tenantId, serviceId: input.serviceId, channelId: channel.id, name: input.name, body: input.body, buttons: input.buttons } });
  await audit(tx, ctx, requestId, "kakao.template_created", "kakaoTemplate", row.id, ["name", "body"], input.serviceId);
  assertFileDeadlines(deadlines);
  return templateDto(row);
}
export async function updateKakaoTemplate(ctx: Context, id: string, input: z.infer<typeof kakaoTemplatePatch>, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, current.serviceId);
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (["submitted", "archived"].includes(current.status)) fail(409, "TEMPLATE_LOCKED", "심사 중이거나 보관된 템플릿은 수정할 수 없습니다.");
    const changed = await tx.kakaoTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ["draft", "rejected", "approved"] } },
      data: { name: input.name, body: input.body, buttons: input.buttons, status: "draft", reviewNote: "", version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const row = await tx.kakaoTemplate.findUniqueOrThrow({ where: { id } });
    await audit(tx, ctx, requestId, "kakao.template_updated", "kakaoTemplate", id, ["name", "body", "status"], current.serviceId);
    assertFileDeadlines(deadlines);
    return templateDto(row);
  });
}
export async function submitKakaoTemplate(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, current.serviceId);
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (!["draft", "rejected"].includes(current.status)) fail(409, "REVIEW_UNAVAILABLE", "초안이거나 반려된 템플릿만 심사 요청할 수 있습니다.");
    const changed = await tx.kakaoTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version, status: { in: ["draft", "rejected"] } }, data: { status: "submitted", reviewNote: "", version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const row = await tx.kakaoTemplate.findUniqueOrThrow({ where: { id } });
    await audit(tx, ctx, requestId, "kakao.template_submitted", "kakaoTemplate", id, ["status"], current.serviceId);
    assertFileDeadlines(deadlines);
    if (env.KAKAO_PROVIDER === "local") {
      const rejected = row.body.includes("#반려");
      const result = await localReview({ kind: "template", id, version: row.version, outcome: rejected ? "rejected" : "approved", note: rejected ? "로컬 심사: 반려 표지" : "로컬 심사: 승인" }, requestId, tx);
      assertFileDeadlines(deadlines);
      return result;
    }
    return templateDto(row);
  });
}
export async function readKakaoReview(ctx: Context, id: string) {
  const row = await readKakaoTemplate(ctx, id);
  return { id: row.id, status: row.status, reviewNote: row.reviewNote,
    providerMatched: env.KAKAO_PROVIDER === "local" && ["approved", "rejected"].includes(row.status) };
}
export function previewKakaoTemplate(input: z.infer<typeof kakaoPreviewInput>) {
  const names = kakaoVariables(input.body);
  const missing = names.filter(name => input.values[name] === undefined);
  if (missing.length) fail(422, "MISSING_VARIABLE", "템플릿 변수 값을 모두 입력해주세요.");
  const text = input.body.replaceAll(/#\{([A-Za-z0-9_]{1,30})\}/g, (_, name: string) => input.values[name]);
  return { text, buttons: input.buttons, stored: false };
}
export async function sendKakaoTemplate(ctx: Context, id: string, version: number, key: string | null, requestId: string): Promise<KakaoMockDelivery> {
  let deadlines: Awaited<ReturnType<typeof lockService>>;
  async function authorize(tx: Transaction) {
    const initial = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!initial) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    deadlines = await lockService(tx, ctx, initial.serviceId);
    return initial;
  }
  const result = await idempotent("kakao-mock-send:" + ctx.tenantId + ":" + id, key, { id, version }, async tx => {
    const initial = await authorize(tx);
    // 채널 변경/보관과 템플릿 변경/심사 결과가 영수증 저장 전 끼어들 수 없다.
    const channel = await lockChannel(tx, ctx.tenantId, initial.channelId);
    await tx.$queryRaw`SELECT id FROM "KakaoTemplate" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const row = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    if (row.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (row.status !== "approved" || channel.status !== "verified") fail(409, "TEMPLATE_NOT_APPROVED", "승인된 템플릿과 확인된 채널만 발송할 수 있습니다.");
    if (env.KAKAO_PROVIDER !== "local") fail(503, "KAKAO_PROVIDER_REQUIRED", "알림톡 발송 공급자를 연결한 뒤에 발송할 수 있습니다.");
    const receipt = await tx.kakaoMockReceipt.create({ data: { tenantId: ctx.tenantId, serviceId: row.serviceId, templateId: id, templateVersion: row.version,
      channelId: row.channelId, channelVersion: channel.version, contentHash: tokenHash(JSON.stringify({ body: row.body, buttons: row.buttons })), requestId } });
    await audit(tx, ctx, requestId, "kakao.mock_delivered", "kakaoMockReceipt", receipt.id, ["status"], row.serviceId);
    const body: KakaoMockDelivery = { id: receipt.id, receiptId: "local-kakao:" + receipt.id, serviceId: row.serviceId, templateId: id, templateVersion: row.version,
      channelId: row.channelId, channelVersion: channel.version, status: "local_delivered", mock: true, createdAt: receipt.createdAt.toISOString() };
    return { status: 200, body };
  }, authorize, undefined, async () => { assertFileDeadlines(deadlines); });
  return result.body;
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function applyKakaoReview(raw: string, signature: string, secret: string | undefined, requestId: string = randomUUID(), transaction?: Transaction) {
  if (!secret) fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 심사 결과 비밀이 설정되지 않았습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "KAKAO_SIGNATURE_INVALID", "카카오 심사 서명을 확인할 수 없습니다.");
  const input = kakaoReviewInput.parse(JSON.parse(raw));
  const apply = async (tx: Transaction) => {
    if (input.kind === "channel") {
      if (input.outcome !== "verified") fail(422, "INVALID_REVIEW", "채널 결과는 확인만 받을 수 있습니다.");
      const row = await tx.kakaoChannel.findUnique({ where: { id: input.id } });
      if (!row || row.status === "archived") fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
      const changed = await tx.kakaoChannel.updateMany({ where: { id: row.id, version: input.version, status: "pending" }, data: { status: "verified", version: { increment: 1 } } });
      if (changed.count !== 1) fail(409, "REVIEW_UNAVAILABLE", "이미 처리되었거나 변경된 확인 요청입니다.");
      const saved = await tx.kakaoChannel.findUniqueOrThrow({ where: { id: row.id } });
      await audit(tx, { tenantId: row.tenantId, user: { id: null } }, requestId, "kakao.channel_verified", "kakaoChannel", row.id, ["status"], row.serviceId);
      return channelDto(saved);
    }
    if (input.outcome === "verified") fail(422, "INVALID_REVIEW", "템플릿은 승인 또는 반려만 받을 수 있습니다.");
    const row = await tx.kakaoTemplate.findUnique({ where: { id: input.id } });
    if (!row || row.status !== "submitted") fail(409, "REVIEW_UNAVAILABLE", "심사 요청 중인 템플릿만 결과를 반영할 수 있습니다.");
    const changed = await tx.kakaoTemplate.updateMany({ where: { id: row.id, version: input.version, status: "submitted" }, data: { status: input.outcome === "approved" ? "approved" : "rejected", reviewNote: input.note, version: { increment: 1 } } });
    if (changed.count !== 1) fail(409, "REVIEW_UNAVAILABLE", "이미 처리되었거나 변경된 심사 요청입니다.");
    const saved = await tx.kakaoTemplate.findUniqueOrThrow({ where: { id: row.id } });
    await audit(tx, { tenantId: row.tenantId, user: { id: null } }, requestId, "kakao.template_" + input.outcome, "kakaoTemplate", row.id, ["status", "reviewNote"], row.serviceId);
    return templateDto(saved);
  };
  return transaction ? apply(transaction) : db.$transaction(apply);
}

export async function readKakaoChannel(ctx: Context, id: string) {
  return db.$transaction(async tx => {
    const row = await tx.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!row) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, row.serviceId);
    assertFileDeadlines(deadlines);
    return channelDto(row);
  });
}
export async function readKakaoTemplate(ctx: Context, id: string) {
  return db.$transaction(async tx => {
    const row = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { channel: true } });
    if (!row) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, row.serviceId);
    assertFileDeadlines(deadlines);
    return { ...templateDto(row), channelName: row.channel.name, channelSearchId: row.channel.searchId };
  });
}
export async function removeKakaoChannel(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const initial = await tx.kakaoChannel.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!initial) fail(404, "NOT_FOUND", "카카오 채널을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, initial.serviceId);
    const current = await lockChannel(tx, ctx.tenantId, id);
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    if (await tx.kakaoTemplate.count({ where: { tenantId: ctx.tenantId, channelId: id, status: { not: "archived" } } }))
      fail(409, "CHANNEL_IN_USE", "사용 중인 템플릿이 있어 채널을 보관할 수 없습니다.");
    const templates = await tx.kakaoTemplate.count({ where: { tenantId: ctx.tenantId, channelId: id } });
    if (templates) {
      const row = await tx.kakaoChannel.update({ where: { id }, data: { status: "archived", version: { increment: 1 } } });
      await audit(tx, ctx, requestId, "kakao.channel_archived", "kakaoChannel", id, ["status"], current.serviceId);
      assertFileDeadlines(deadlines);
      return { deleted: false, archived: true, body: channelDto(row) };
    }
    await tx.kakaoChannel.delete({ where: { id } });
    await audit(tx, ctx, requestId, "kakao.channel_deleted", "kakaoChannel", id, ["name", "searchId"], current.serviceId);
    assertFileDeadlines(deadlines);
    return { deleted: true, archived: false, body: null };
  });
}
export async function removeKakaoTemplate(ctx: Context, id: string, version: number, requestId: string) {
  return db.$transaction(async tx => {
    const current = await tx.kakaoTemplate.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) fail(404, "NOT_FOUND", "알림톡 템플릿을 찾을 수 없습니다.");
    const deadlines = await lockService(tx, ctx, current.serviceId);
    if (current.version !== version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const referenced = await tx.campaign.count({ where: { tenantId: ctx.tenantId, kakaoTemplateId: id } }) + await tx.kakaoMockReceipt.count({ where: { tenantId: ctx.tenantId, templateId: id } });
    if (current.status !== "draft" || referenced) {
      const changed = await tx.kakaoTemplate.updateMany({ where: { id, tenantId: ctx.tenantId, version }, data: { status: "archived", version: { increment: 1 } } });
      if (changed.count !== 1) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
      const row = await tx.kakaoTemplate.findUniqueOrThrow({ where: { id } });
      await audit(tx, ctx, requestId, "kakao.template_archived", "kakaoTemplate", id, ["status"], current.serviceId);
      assertFileDeadlines(deadlines);
      return { deleted: false, archived: true, body: templateDto(row) };
    }
    const removed = await tx.kakaoTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId, version, status: "draft" } });
    if (removed.count !== 1) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    await audit(tx, ctx, requestId, "kakao.template_deleted", "kakaoTemplate", id, ["name"], current.serviceId);
    assertFileDeadlines(deadlines);
    return { deleted: true, archived: false, body: null };
  });
}
