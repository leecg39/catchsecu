// P06-T06: 본인인증·전자서명 challenge/callback/영수증 소비.
// "local" 공급자는 내장 sandbox 어댑터 — 서버가 서명·검증을 모두 수행해
// 실제 challenge → 서명된 어서션 → 콜백 검증 → 영수증 → 제출 소비 경로를 로컬에서 구동한다.
// 외부 공급자는 어댑터가 없으므로 enabled를 허용하지 않는다(PROVIDER_ADAPTER_REQUIRED).
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail } from "./http";
import { audit } from "./audit";
import { lockPublicPublication } from "./public-publication";
import { versionInclude } from "./forms";
import { companyRetentionDays } from "./security-policy";
import type { VerificationCallbackInput, verificationSubject } from "@/contracts/verification";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const LOCAL_PROVIDER = "local";

// 서명·증거 해시는 DATA_LOOKUP_KEY 계열 키로 고정 — 암호화 키 회전과 무관하게 유효해야 한다.
function verificationMac(...parts: string[]) {
  return createHmac("sha256", Buffer.from(process.env.DATA_LOOKUP_KEY ?? process.env.DATA_ENCRYPTION_KEY ?? "", "hex"))
    .update("vrfy|" + parts.join("|")).digest("hex");
}
function safeEqual(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
// 어서션 canonical — 공급자와 콜백이 같은 문자열에 대해 서명·검증한다.
function assertionCanonical(attemptId: string, eventId: string, nonce: string, kind: string, documentHash: string, subject: z.infer<typeof verificationSubject>) {
  return [attemptId, eventId, nonce, kind, documentHash, subject.name.trim(), subject.birthDate, "verified"].join("|");
}
function receiptToken(attemptId: string) {
  return `${attemptId}.${verificationMac("receipt", attemptId)}`;
}
// 게시 버전에 바인딩된 동의 문서 집합의 해시 — 인증 시점의 문서와 제출 시점이 같은지 검증한다.
export function verificationDocumentHash(formVersionId: string, bindings: { documentVersionId: string }[]) {
  return verificationMac("doc", formVersionId, ...bindings.map(binding => binding.documentVersionId).sort());
}

type IntegrationRow = { id: string; version: number; identityProvider: string | null; signatureProvider: string | null; environment: string; status: string };
function usableProvider(row: IntegrationRow | null | undefined, kind: "identity" | "signature") {
  if (!row || row.status !== "enabled") fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증 연동이 사용 상태가 아닙니다. 관리자가 연동을 사용으로 전환해야 인증이 가능합니다.");
  const provider = kind === "identity" ? row.identityProvider : row.signatureProvider;
  if (!provider) fail(503, kind === "identity" ? "IDENTITY_PROVIDER_REQUIRED" : "SIGNATURE_PROVIDER_REQUIRED", "해당 검증 공급자가 설정되지 않았습니다.");
  if (provider !== LOCAL_PROVIDER || row.environment !== "sandbox")
    fail(503, "PROVIDER_ADAPTER_REQUIRED", "외부 공급자 어댑터가 아직 연결되지 않았습니다. local sandbox 공급자만 사용할 수 있습니다.");
}

// submissions.ts와의 순환 import를 피하기 위해 publication 조회를 여기서 둔다.
async function verificationPublication(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    const initial = await tx.publication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true } });
    if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
    await lockPublicPublication(tx, initial.id);
    return tx.publication.findUniqueOrThrow({ where: { id: initial.id }, include: {
      formVersion: { include: versionInclude }, form: { include: { service: { include: { tenant: { select: { status: true } } } } } },
    } });
  }, { timeout: 15000 });
}

export async function issueVerificationChallenge(token: string, kind: "identity" | "signature", requestId: string) {
  const publication = await verificationPublication(token);
  const version = publication.formVersion;
  if (!version.verify) fail(422, "VERIFICATION_NOT_REQUIRED", "이 캐치폼은 본인인증을 요구하지 않습니다.");
  const integration = await db.verificationIntegration.findUnique({ where: { tenantId_serviceId: { tenantId: publication.tenantId, serviceId: publication.form.serviceId } } });
  usableProvider(integration, kind);
  const nonce = opaqueToken();
  const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MS);
  const attempt = await db.$transaction(async tx => {
    const row = await tx.verificationAttempt.create({ data: {
      tenantId: publication.tenantId, serviceId: publication.form.serviceId,
      integrationId: integration!.id, integrationVersion: integration!.version,
      formId: publication.formId, formVersionId: version.id, publicationId: publication.id,
      kind, environment: integration!.environment,
      browserNonceHash: tokenHash("nonce|" + nonce),
      requestHash: verificationMac("req", publication.tenantId, publication.form.serviceId, version.id, publication.id, kind),
      documentHash: verificationDocumentHash(version.id, version.documentBindings),
      expiresAt,
    } });
    await audit(tx, { tenantId: publication.tenantId, user: { id: null } }, requestId, "verification.challenge", "verificationAttempt", row.id,
      ["kind", "environment"], publication.form.serviceId);
    return row;
  });
  return { attemptId: attempt.id, kind, provider: LOCAL_PROVIDER, environment: integration!.environment as "sandbox" | "production",
    nonce, expiresAt: expiresAt.toISOString() };
}

// 내장 sandbox 공급자 — challenge에 묶인 어서션에 서명해 반환한다. 외부 IdP 역할을 로컬에서 재현한다.
export async function localVerificationResponse(input: { attemptId: string; nonce: string; subject: z.infer<typeof verificationSubject> }, requestId: string) {
  const attempt = await db.verificationAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt) fail(404, "NOT_FOUND", "인증 요청을 찾을 수 없습니다.");
  if (attempt.status !== "pending") fail(409, "VERIFICATION_REPLAYED", "이미 처리된 인증 요청입니다.");
  if (attempt.expiresAt <= new Date()) fail(410, "VERIFICATION_EXPIRED", "인증 요청이 만료되었습니다. 다시 시작해주세요.");
  if (!safeEqual(tokenHash("nonce|" + input.nonce), attempt.browserNonceHash)) fail(403, "VERIFICATION_FORGED", "인증 요청의 nonce가 일치하지 않습니다.");
  const eventId = randomUUID();
  const signature = verificationMac("assert", assertionCanonical(input.attemptId, eventId, input.nonce, attempt.kind, attempt.documentHash, input.subject));
  await audit(db, { tenantId: attempt.tenantId, user: { id: null } }, requestId, "verification.provider_response", "verificationAttempt", attempt.id, ["status"], attempt.serviceId);
  return { attemptId: input.attemptId, eventId, nonce: input.nonce, status: "verified" as const, subject: input.subject, signature };
}

export async function completeVerification(token: string, input: VerificationCallbackInput, requestId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  const outcome = await db.$transaction(async tx => {
    const publicationRow = await tx.publication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true } });
    if (!publicationRow) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
    await tx.$queryRaw`SELECT id FROM "VerificationAttempt" WHERE id=${input.attemptId} FOR UPDATE`;
    const attempt = await tx.verificationAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.publicationId !== publicationRow.id) fail(404, "NOT_FOUND", "인증 요청을 찾을 수 없습니다.");
    if (attempt.status !== "pending") fail(409, "VERIFICATION_REPLAYED", "이미 처리된 인증 요청입니다.");
    if (attempt.expiresAt <= new Date()) {
      await tx.verificationAttempt.update({ where: { id: attempt.id }, data: { status: "expired", version: { increment: 1 } } });
      fail(410, "VERIFICATION_EXPIRED", "인증 요청이 만료되었습니다. 다시 시작해주세요.");
    }
    const nonceOk = safeEqual(tokenHash("nonce|" + input.nonce), attempt.browserNonceHash);
    const expected = verificationMac("assert", assertionCanonical(input.attemptId, input.eventId, input.nonce, attempt.kind, attempt.documentHash, input.subject));
    const signatureValid = nonceOk && safeEqual(input.signature, expected);
    const bodyHash = verificationMac("body", JSON.stringify(input));
    // 위조·변조 콜백도 포렌식 이벤트로 남긴다(attempt 상태는 바꾸지 않음).
    // providerEventHash에 본문 해시를 섞어 변조본이 정본의 eventId를 소모하지 못하게 한다.
    const event = await tx.verificationEvent.create({ data: {
      tenantId: attempt.tenantId, serviceId: attempt.serviceId, attemptId: attempt.id,
      providerEventHash: tokenHash("event|" + input.eventId + "|" + bodyHash), bodyHash,
      signatureValid, verificationStatus: signatureValid ? "verified" : "rejected",
    } }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002")
        fail(409, "VERIFICATION_REPLAYED", "이미 처리된 인증 이벤트입니다.");
      throw error;
    });
    if (!signatureValid) return { ok: false as const };
    const verifiedAt = new Date();
    await tx.verificationAttempt.update({ where: { id: attempt.id }, data: {
      status: "verified", verifiedAt, version: { increment: 1 },
      providerRequestHash: bodyHash, providerRequestCipher: encrypt(input),
    } });
    // 영수증 보유기한은 제출물의 originalRetentionUntil을 초과할 수 없다(verification_receipt_live_submission).
    // 제출 시점과 같은 공식을 적용한다: 폼 버전 지정 → 폼 사후 지정 → 회사 정책.
    const fv = await tx.formVersion.findUniqueOrThrow({ where: { id: attempt.formVersionId },
      select: { retentionDays: true, form: { select: { designatedRetentionDays: true } } } });
    const retentionDays = fv.retentionDays ?? fv.form.designatedRetentionDays ?? await companyRetentionDays(tx, attempt.tenantId);
    const receipt = await tx.verificationReceipt.create({ data: {
      tenantId: attempt.tenantId, serviceId: attempt.serviceId, attemptId: attempt.id, eventId: event.id,
      formVersionId: attempt.formVersionId, publicationId: attempt.publicationId,
      provider: LOCAL_PROVIDER, kind: attempt.kind, environment: attempt.environment,
      documentHash: attempt.documentHash, proofHash: bodyHash,
      verifiedAt, retentionUntil: new Date(verifiedAt.getTime() + retentionDays * 86400000),
    } });
    await audit(tx, { tenantId: attempt.tenantId, user: { id: null } }, requestId, "verification.verified", "verificationAttempt", attempt.id,
      ["status"], attempt.serviceId);
    return { ok: true as const, receiptId: receipt.id, verifiedAt: receipt.verifiedAt };
  }, { timeout: 15000 });
  if (!outcome.ok) fail(403, "VERIFICATION_FORGED", "공급자 서명이 유효하지 않습니다. 위조 또는 변조된 콜백입니다.");
  return { attemptId: input.attemptId, receipt: receiptToken(input.attemptId), verifiedAt: outcome.verifiedAt.toISOString() };
}

// 제출 tx 안에서 호출 — 영수증이 이 publication/formVersion에 귀속되고 미사용인지 확인 후 소비한다.
export async function consumeVerificationReceipt(tx: Transaction, live: { id: string; tenantId: string; formVersionId: string; form: { serviceId: string } },
  version: { verify: boolean },
  verification: { attemptId: string; receipt: string } | undefined, submissionId: string, requestId: string) {
  if (!version.verify) {
    if (verification) fail(422, "VERIFICATION_NOT_REQUIRED", "이 캐치폼은 본인인증을 요구하지 않습니다.");
    return;
  }
  if (!verification) fail(422, "VERIFICATION_REQUIRED", "본인인증 영수증이 필요합니다.");
  const [attemptId, mac] = verification.receipt.split(".");
  if (attemptId !== verification.attemptId || !mac || !safeEqual(mac, verificationMac("receipt", attemptId)))
    fail(403, "VERIFICATION_FORGED", "인증 영수증이 유효하지 않습니다.");
  await tx.$queryRaw`SELECT id FROM "VerificationAttempt" WHERE id=${attemptId} FOR UPDATE`;
  const attempt = await tx.verificationAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.tenantId !== live.tenantId || attempt.serviceId !== live.form.serviceId ||
    attempt.publicationId !== live.id || attempt.formVersionId !== live.formVersionId)
    fail(404, "NOT_FOUND", "이 캐치폼의 인증 요청이 아닙니다.");
  if (attempt.status === "consumed") fail(409, "VERIFICATION_CONSUMED", "이미 사용된 인증 영수증입니다.");
  if (attempt.status !== "verified" || attempt.expiresAt <= new Date()) fail(422, "VERIFICATION_STALE", "인증이 만료되었거나 완료되지 않았습니다. 다시 인증해주세요.");
  const bindings = await tx.formDocumentBinding.findMany({ where: { formVersionId: live.formVersionId }, select: { documentVersionId: true } });
  if (attempt.documentHash !== verificationDocumentHash(live.formVersionId, bindings))
    fail(409, "VERIFICATION_STALE", "인증 후 문서가 변경되었습니다. 다시 인증해주세요.");
  const receipt = await tx.verificationReceipt.findUnique({ where: { attemptId } });
  if (!receipt || receipt.tenantId !== live.tenantId || receipt.serviceId !== live.form.serviceId) fail(404, "NOT_FOUND", "인증 영수증을 찾을 수 없습니다.");
  if (receipt.retentionUntil <= new Date()) fail(410, "VERIFICATION_EXPIRED", "인증 영수증이 만료되었습니다. 다시 인증해주세요.");
  // 동시 제출 경합은 조건부 갱신으로 한 건만 성공한다.
  const bound = await tx.verificationReceipt.updateMany({ where: { attemptId, submissionId: null }, data: { submissionId } });
  if (!bound.count) fail(409, "VERIFICATION_CONSUMED", "이미 사용된 인증 영수증입니다.");
  await tx.verificationAttempt.update({ where: { id: attemptId }, data: { status: "consumed", version: { increment: 1 } } });
  await audit(tx, { tenantId: live.tenantId, user: { id: null } }, requestId, "verification.consumed", "verificationAttempt", attemptId, ["submissionId"], live.form.serviceId);
}

// 워커 정리: 만료된 pending 시도만 expired로 전이한다.
// verified/consumed 시도는 provider 원문이 증거이므로 CHECK가 잠긴다 — 파기 워커가 영수증과 함께 삭제한다.
export async function cleanupVerification() {
  const expired = await db.verificationAttempt.updateMany({ where: { status: "pending", expiresAt: { lt: new Date() } },
    data: { status: "expired", version: { increment: 1 } } });
  return { expired: expired.count };
}
