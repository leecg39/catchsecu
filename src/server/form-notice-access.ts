import { z } from "zod";
import type { Transaction } from "./db";
import { decrypt, encrypt } from "./crypto";
import { fail } from "./http";

const COMPLETION_PROOF_TTL_MS = 30 * 60 * 1000;
const completionProofPayload = z.object({
  kind: z.literal("form-completion"), version: z.literal(1), publicationId: z.uuid(),
  formVersionId: z.uuid(), submissionId: z.uuid(), expiresAt: z.number().int().positive(),
}).strict();

export function issueCompletionProof(publicationId: string, formVersionId: string, submissionId: string, now = Date.now()) {
  return encrypt({ kind: "form-completion", version: 1, publicationId, formVersionId, submissionId,
    expiresAt: now + COMPLETION_PROOF_TTL_MS });
}

function parseCompletionProof(value: string) {
  if (!value || value.length > 2048) fail(404, "NOT_FOUND", "제출 완료 안내를 찾을 수 없습니다.");
  try {
    const payload = completionProofPayload.parse(decrypt<unknown>(value));
    if (payload.expiresAt <= Date.now()) fail(410, "COMPLETION_PROOF_EXPIRED", "제출 완료 안내의 열람 시간이 지났습니다.");
    return payload;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    fail(404, "NOT_FOUND", "제출 완료 안내를 찾을 수 없습니다.");
  }
}

export async function lockCompletionProof(tx: Transaction, publication: { id: string; tenantId: string; formVersionId: string }, proof: string) {
  const payload = parseCompletionProof(proof);
  if (payload.publicationId !== publication.id || payload.formVersionId !== publication.formVersionId)
    fail(404, "NOT_FOUND", "제출 완료 안내를 찾을 수 없습니다.");
  await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${payload.submissionId} AND "tenantId"=${publication.tenantId} AND "publicationId"=${publication.id} AND "formVersionId"=${publication.formVersionId} FOR SHARE`;
  const submission = await tx.submission.findFirst({ where: { id: payload.submissionId, tenantId: publication.tenantId,
    publicationId: publication.id, formVersionId: publication.formVersionId } });
  if (!submission) fail(404, "NOT_FOUND", "제출 완료 안내를 찾을 수 없습니다.");
  if (!["submitted", "corrected"].includes(submission.status) || (!submission.legalHold && submission.retentionUntil <= new Date()))
    fail(410, "COMPLETION_UNAVAILABLE", "제출 완료 안내를 더 이상 열람할 수 없습니다.");
  if (payload.expiresAt <= Date.now()) fail(410, "COMPLETION_PROOF_EXPIRED", "제출 완료 안내의 열람 시간이 지났습니다.");
  return submission;
}
