import { db, type Transaction } from "./db";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { fail } from "./http";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
export async function idempotent<T>(scope: string, key: string | null, payload: unknown,
  operation: (tx: Transaction) => Promise<{ status: number; body: T; resource?: { tenantId?: string; resourceType: "mfa-exception" | "ip-rule" | "submission" | "file" | "support-ticket" | "notice" | "guide" | "form" | "template" | "shareGrant" | "verificationIntegration" | "subprocessor" | "subprocessor-notice" | "kakao-channel" | "kakao-template" | "payment-order"; resourceId: string } }>,
  validateReplay?: (tx: Transaction) => Promise<unknown>,
  replayBody?: (tx: Transaction, cached: T) => Promise<T>,
  finalCheck?: (tx: Transaction) => Promise<unknown>): Promise<{ status: number; body: T }> {
  if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) fail(400, "IDEMPOTENCY_REQUIRED", "유효한 Idempotency-Key가 필요합니다.");
  const requestHash = tokenHash(canonical(payload));
  return db.$transaction(async tx => {
    // Transaction-scoped lock serializes an identical key even before its record exists.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope + ":" + key}, 0))`;
    const saved = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (saved) {
      if (saved.invalidatedAt || !saved.responseCipher || saved.expiresAt <= new Date())
        fail(410, "IDEMPOTENCY_EXPIRED", "이 요청의 보관 기간이 끝났습니다. 최신 처리 결과를 확인해주세요.");
      await validateReplay?.(tx);
      const legacyForm = !saved.resourceType && /^(form:(create|copy):|template:use:)/.test(scope)
        ? decrypt<{ id?: string }>(saved.responseCipher).id : undefined;
      const formId = saved.resourceType === "form" ? saved.resourceId : legacyForm;
      if (formId) {
        await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${formId} FOR SHARE`;
        const form = await tx.form.findFirst({ where: { id: formId, ...(saved.tenantId ? { tenantId: saved.tenantId } : {}) } });
        if (!form) fail(410, "IDEMPOTENCY_EXPIRED", "이미 완전 삭제된 캐치폼 요청입니다.");
      }
      const legacyTemplate = !saved.resourceType && scope.startsWith("template:create:") ? decrypt<{ id?: string }>(saved.responseCipher).id : undefined;
      const templateId = saved.resourceType === "template" ? saved.resourceId : legacyTemplate;
      if (templateId) {
        await tx.$queryRaw`SELECT id FROM "FormTemplate" WHERE id=${templateId} FOR SHARE`;
        const template = await tx.formTemplate.findFirst({ where: { id: templateId, ...(saved.tenantId ? { tenantId: saved.tenantId } : {}) } });
        if (!template || template.status !== "active") fail(410, "IDEMPOTENCY_EXPIRED", "이미 삭제된 템플릿 요청입니다.");
      }
      let submissionId = saved.resourceType === "submission" ? saved.resourceId : null;
      if (saved.resourceType === "file" && saved.resourceId) {
        const file = await tx.fileObject.findUnique({ where: { id: saved.resourceId } });
        if (!file || ["deleting", "deleted"].includes(file.status)) fail(410, "IDEMPOTENCY_EXPIRED", "이미 삭제된 파일 요청입니다.");
        submissionId = file.submissionId;
      }
      if (saved.resourceType === "support-ticket" && saved.resourceId) {
        await tx.$queryRaw`SELECT id FROM "SupportTicket" WHERE id=${saved.resourceId} FOR SHARE`;
        const ticket = await tx.supportTicket.findUnique({ where: { id: saved.resourceId } });
        if (!ticket || ticket.status === "archived") fail(410, "IDEMPOTENCY_EXPIRED", "이미 삭제된 요청입니다.");
      }
      if (saved.resourceType === "notice" && saved.resourceId) {
        await tx.$queryRaw`SELECT id FROM "Notice" WHERE id=${saved.resourceId} FOR SHARE`;
        const notice = await tx.notice.findUnique({ where: { id: saved.resourceId } });
        if (!notice || notice.status === "archived") fail(410, "IDEMPOTENCY_EXPIRED", "이미 보관된 공지 요청입니다.");
      }
      if (saved.resourceType === "guide" && saved.resourceId) {
        await tx.$queryRaw`SELECT id FROM "Guide" WHERE id=${saved.resourceId} FOR SHARE`;
        const guide = await tx.guide.findUnique({ where: { id: saved.resourceId } });
        if (!guide || guide.status === "archived") fail(410, "IDEMPOTENCY_EXPIRED", "이미 보관된 가이드 요청입니다.");
      }
      if (submissionId) {
        await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${submissionId} FOR SHARE`;
        const row = await tx.submission.findUnique({ where: { id: submissionId } });
        if (!row || ["destroying", "destroyed"].includes(row.status) || (!row.legalHold && row.retentionUntil <= new Date()))
          fail(410, "IDEMPOTENCY_EXPIRED", "이 응답의 보유 기한이 끝났습니다.");
      }
      if (saved.resourceType === "file" && saved.resourceId) {
        await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${saved.resourceId} FOR SHARE`;
        const file = await tx.fileObject.findUnique({ where: { id: saved.resourceId } });
        if (!file || ["attached", "deleting", "deleted"].includes(file.status) || !file.expiresAt || file.expiresAt <= new Date())
          fail(410, "IDEMPOTENCY_EXPIRED", "이 업로드 요청의 사용 기간이 끝났습니다.");
      }
      if (saved.requestHash !== requestHash) fail(409, "IDEMPOTENCY_MISMATCH", "같은 요청 키에 다른 내용이 사용되었습니다.");
      const cached = decrypt<T>(saved.responseCipher);
      const body = replayBody ? await replayBody(tx, cached) : cached;
      await finalCheck?.(tx);
      return { status: saved.statusCode, body };
    }
    const result = await operation(tx);
    await tx.idempotencyRecord.create({ data: { scope, key, requestHash, statusCode: result.status,
      responseCipher: encrypt(result.body), expiresAt: new Date(Date.now() + 86400000), ...result.resource } });
    await finalCheck?.(tx);
    return { status: result.status, body: result.body };
  }, { timeout: 15000 });
}
export async function expireIdempotencyResponses(now = new Date()) {
  // Retain only the replay marker, never the encrypted response or payload hash.
  return db.idempotencyRecord.updateMany({ where: { expiresAt: { lte: now }, invalidatedAt: null },
    data: { responseCipher: null, requestHash: null, invalidatedAt: now } });
}
