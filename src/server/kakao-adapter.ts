// Solapi 알림톡 어댑터 — SMS와 같은 Solapi 계정의 카카오 비즈채널·템플릿·발송 API를 연결한다.
// 채널 searchId(@xxx) ↔ pfId 는 검증 시점에 해결해 providerKey에 고정하고,
// 템플릿 등록은 providerTemplateId를 받아 승인 전이와 영수증 대사에 사용한다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { fail } from "./http";
import { postLedgerTransfer } from "./ledger";
import { campaignLedgerSource } from "./campaign-ledger";
import { solapiConfigured } from "./sender-providers";
import { solapiRequest, solapiResponse } from "./sms-adapter";

const channelListBody = z.object({
  channelList: z.array(z.object({ pfId: z.string().min(1), channelId: z.string().optional(), searchId: z.string().optional() }).passthrough()).optional(),
  channels: z.array(z.object({ pfId: z.string().min(1), channelId: z.string().optional(), searchId: z.string().optional() }).passthrough()).optional() }).passthrough();
const templateStatusBody = z.object({ status: z.string().optional(), comments: z.string().optional(), rejectedReason: z.string().optional() }).passthrough();
const receiptBody = z.object({
  deliveryId: z.uuid(),
  receiptId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  outcome: z.enum(["accepted", "failed", "timeout"]),
  attempt: z.number().int().min(1).max(5).optional(),
}).strict();
export type KakaoReceiptResult = { deliveryId: string; receiptId: string; status: "provider_accepted" | "failed" | "unknown"; duplicate: boolean };

/** 이 회사의 카카오 공급자(Solapi) 자격이 연결됐는지 — SOLAPI_TENANT_ID 스코프와 동일 규칙. */
export function kakaoSolapiConfigured(tenantId: string) {
  return env.KAKAO_PROVIDER === "solapi" && solapiConfigured(tenantId);
}
async function callSolapi(path: string, body: unknown, rejected: string, unavailable: string) {
  const request = solapiRequest(path, body);
  let response: Response;
  try { response = await fetch(request.url, request.init); }
  catch { fail(503, unavailable, "카카오 공급자에 연결할 수 없습니다."); }
  const parsed = solapiResponse.parse(await response.json().catch(() => ({})));
  if (response.status >= 500) fail(503, unavailable, "카카오 공급자에 연결할 수 없습니다.");
  if (parsed.errorCode || !response.ok) fail(422, rejected, "카카오 공급자가 요청을 거부했습니다. " + (parsed.errorMessage ?? parsed.errorCode ?? response.status));
  return parsed;
}
/** searchId → pfId 해결. providerKey가 이미 있으면 조회 없이 재사용한다. */
export async function resolveKakaoChannelPfId(tenantId: string, searchId: string, cached?: string | null) {
  if (cached) return cached;
  if (!kakaoSolapiConfigured(tenantId)) fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 공급자를 연결한 뒤에 채널을 확인할 수 있습니다.");
  const request = solapiRequest("/kakao/v2/channels?searchId=" + encodeURIComponent(searchId));
  let response: Response;
  try { response = await fetch(request.url, request.init); }
  catch { fail(503, "KAKAO_PROVIDER_UNAVAILABLE", "카카오 공급자에 연결할 수 없습니다."); }
  const parsed = channelListBody.parse(await response.json().catch(() => ({})));
  if (!response.ok) fail(503, "KAKAO_PROVIDER_UNAVAILABLE", "카카오 채널 목록을 확인할 수 없습니다.");
  const rows = parsed.channelList ?? parsed.channels ?? [];
  const hit = rows.find(row => (row.channelId ?? row.searchId) === searchId);
  if (!hit) fail(404, "KAKAO_CHANNEL_NOT_LINKED", "공급자에 연동된 카카오 채널이 아닙니다. Solapi 콘솔에서 채널을 연동해주세요.");
  return hit.pfId;
}
/** 템플릿을 공급자 심사에 등록하고 providerTemplateId를 돌려준다. */
export async function registerKakaoTemplate(tenantId: string, input: { pfId: string; name: string; body: string; buttons: unknown }) {
  const buttons = Array.isArray(input.buttons)
    ? (input.buttons as { name: string; type: string; link?: string }[]).map(b => ({ buttonName: b.name, buttonType: b.type, linkMo: b.link ?? "", linkPc: b.link ?? "" }))
    : [];
  const parsed = await callSolapi("/kakao/v2/templates", { pfId: input.pfId, name: input.name, content: input.body, buttons },
    "KAKAO_TEMPLATE_REJECTED", "KAKAO_PROVIDER_UNAVAILABLE");
  const templateId = (parsed as Record<string, unknown>).templateId ?? (parsed as Record<string, unknown>).kakaoTemplateId;
  if (typeof templateId !== "string" || !templateId) fail(503, "KAKAO_PROVIDER_RESPONSE", "공급자 템플릿 응답 형식을 확인할 수 없습니다.");
  return templateId;
}
/** 공급자 심사 상태를 도메인 상태로 변환한다. 알 수 없는 값은 심사 중으로 둔다. */
export async function fetchKakaoTemplateStatus(tenantId: string, providerTemplateId: string) {
  if (!kakaoSolapiConfigured(tenantId)) fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 공급자를 연결한 뒤에 심사 상태를 확인할 수 있습니다.");
  const request = solapiRequest("/kakao/v2/templates/" + encodeURIComponent(providerTemplateId));
  let response: Response;
  try { response = await fetch(request.url, request.init); }
  catch { fail(503, "KAKAO_PROVIDER_UNAVAILABLE", "카카오 공급자에 연결할 수 없습니다."); }
  const parsed = templateStatusBody.parse(await response.json().catch(() => ({})));
  if (!response.ok) fail(503, "KAKAO_PROVIDER_UNAVAILABLE", "카카오 템플릿 상태를 확인할 수 없습니다.");
  const status = (parsed.status ?? "").toUpperCase();
  return { status: (status === "A" || status === "APPROVED" ? "approved" : status === "R" || status === "REJECTED" ? "rejected" : "submitted") as "approved" | "rejected" | "submitted",
    note: parsed.rejectedReason ?? parsed.comments ?? "" };
}
/** 알림톡 발송 — Solapi messages/v4/send의 kakaoOptions. disableSms로 대체발송은 앱의 fallback 잡에만 맡긴다. */
export async function deliverKakaoAlimtalk(input: { tenantId: string; to: string; pfId: string; templateId: string; variables: Record<string, string> }) {
  if (!kakaoSolapiConfigured(input.tenantId)) fail(503, "KAKAO_PROVIDER_REQUIRED", "알림톡 발송 공급자를 연결한 뒤 발송할 수 있습니다.");
  const parsed = await callSolapi("/messages/v4/send", { message: { to: input.to, kakaoOptions: {
    pfId: input.pfId, templateId: input.templateId, variables: input.variables, disableSms: true } } },
    "KAKAO_PROVIDER_REJECTED", "KAKAO_PROVIDER_UNAVAILABLE");
  if (parsed.statusCode && parsed.statusCode !== "2000")
    fail(422, "KAKAO_PROVIDER_REJECTED", "카카오 공급자가 발송을 거부했습니다. " + (parsed.statusMessage ?? parsed.statusCode));
  if (!parsed.groupId) fail(503, "KAKAO_PROVIDER_RESPONSE", "공급자 응답 형식을 확인할 수 없습니다.");
  return { status: "provider_accepted" as const, receiptId: "solapi-kakao:" + parsed.groupId + ":" + (parsed.messageId ?? "") };
}
function signaturesMatch(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected), right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** 서명된 카카오 발송 결과 — SmsReceipt와 동일 계약으로 현재 attempt의 홀드만 정산한다. */
export async function applyKakaoReceipt(raw: string, signature: string, secret: string | undefined): Promise<KakaoReceiptResult> {
  if (!secret) fail(503, "KAKAO_PROVIDER_REQUIRED", "카카오 결과 수신 비밀이 설정되지 않았습니다.");
  if (!signaturesMatch(secret, raw, signature)) fail(401, "KAKAO_SIGNATURE_INVALID", "카카오 결과 서명을 확인할 수 없습니다.");
  const input = receiptBody.parse(JSON.parse(raw));
  const status = input.outcome === "accepted" ? "provider_accepted" : input.outcome === "timeout" ? "unknown" : "failed";
  return db.$transaction(async tx => {
    const initial = await tx.campaignDelivery.findUnique({ where: { id: input.deliveryId } });
    if (!initial) fail(404, "NOT_FOUND", "알림톡 발송 기록을 찾을 수 없습니다.");
    await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${initial.campaignId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CampaignDelivery" WHERE id=${initial.id} FOR UPDATE`;
    const delivery = await tx.campaignDelivery.findUniqueOrThrow({ where: { id: initial.id }, include: { campaign: { select: { channel: true } } } });
    const currentAttempt = Math.max(1, delivery.attempt);
    if (input.attempt === undefined && currentAttempt > 1) fail(422, "KAKAO_ATTEMPT_REQUIRED", "재요청 결과에는 발송 회차가 필요합니다.");
    const attempt = input.attempt ?? currentAttempt;
    const existing = await tx.kakaoReceipt.findUnique({ where: { deliveryId_attempt: { deliveryId: delivery.id, attempt } } });
    if (existing) {
      if (existing.receiptId !== input.receiptId) fail(409, "DUPLICATE_WEBHOOK", "이미 다른 카카오 결과가 기록되어 있습니다.");
      return { deliveryId: delivery.id, receiptId: existing.receiptId, status: existing.status as KakaoReceiptResult["status"], duplicate: true };
    }
    if (attempt !== currentAttempt) fail(409, "STALE_KAKAO_RECEIPT", "현재 발송 회차의 결과가 아닙니다.");
    await tx.kakaoReceipt.create({ data: { tenantId: delivery.tenantId, deliveryId: delivery.id, attempt, receiptId: input.receiptId, status } });
    const deliveryStatus = status === "provider_accepted" ? "accepted" : status;
    // unknown은 종결 상태다 — 수신 결과는 원장만 정산하고 발송 상태는 다시 열지 않는다.
    if (["queued", "sending", "local_delivered"].includes(delivery.status) && (deliveryStatus !== "accepted" || delivery.preferenceId)) {
      await tx.campaignDelivery.update({ where: { id: delivery.id }, data: { status: deliveryStatus, reason: deliveryStatus === "accepted" ? null : input.outcome.toUpperCase(), ...(deliveryStatus === "accepted" ? { acceptedAt: new Date() } : {}) } });
    }
    const sourceId = await campaignLedgerSource(tx, delivery.tenantId, delivery.id, delivery.attempt, delivery.campaign.channel, "kakao-solapi");
    const holds = await tx.ledgerTransaction.findMany({ where: { tenantId: delivery.tenantId, kind: "reserve", sourceKind: "campaign_delivery", sourceId } });
    for (const hold of holds) {
      const settled = await tx.ledgerTransaction.findFirst({ where: { reservationId: hold.id, kind: { in: ["release", "capture"] } } });
      if (settled) continue;
      await postLedgerTransfer(tx, { tenantId: delivery.tenantId, serviceId: delivery.serviceId, currency: hold.currency,
        kind: status === "provider_accepted" ? "capture" : "release", amount: hold.amount,
        sourceKind: "campaign_delivery", sourceId: hold.sourceId, reservationId: hold.id });
    }
    return { deliveryId: delivery.id, receiptId: input.receiptId, status, duplicate: false };
  });
}
