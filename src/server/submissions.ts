import { emitNotificationEvent } from "./notifications";
import { collectMarketing } from "./marketing";
import { bindSubmissionSubject } from "./subject-identity";
import { consentBundle } from "./form-documents";
import { createConsentReceipt, validateDocumentConsents } from "./consent-receipts";
import { validateAnswers } from "./answer-validation";
import { rowSchema } from "@/contracts/questions";
import { submissionFilters, type SubmissionFilters } from "@/contracts/submissions";
import { lockResponseForm, lockResponseRows, responseWhere } from "./submission-query";
import { attachPublicFiles } from "./file-bindings";
import { canReadFiles, fileInfo, lockFilePublication } from "./file-access";
import { submissionDataAvailable } from "@/contracts/destruction";
import { z } from "zod";
import { db } from "./db";
import { type Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { idempotent } from "./idempotency";
import { contentDto, versionInclude } from "./forms";
import { companyRetentionDays } from "./security-policy";
import { submissionInput } from "@/contracts/domains";
import { lockPublicPublication } from "./public-publication";

export async function activePublication(token: string) {
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
export async function publicForm(token: string) {
  const publication = await activePublication(token);
  const { documentConsents: _selections, ...content } = contentDto(publication.formVersion); void _selections;
  // 보유 기간을 지정하지 않은 폼은 현재 회사 기본 보유 기간을 안내에 표시한다.
  if (content.retentionDays === null) {
    const policy = await db.securityPolicy.findUnique({ where: { tenantId: publication.tenantId }, select: { retentionDays: true } });
    if (!policy) fail(409, "POLICY_REQUIRED", "회사 보안 정책이 없습니다.");
    content.retentionDays = policy.retentionDays;
  }
  return { title: publication.formVersion.title, content, consentBundle: consentBundle(publication.formVersion),
    closed: publication.responseCount >= publication.maxResponses, expiresAt: publication.expiresAt };
}
export async function submitForm(token: string, input: z.infer<typeof submissionInput>, key: string | null, requestId: string) {
  const publication = await activePublication(token);
  if (publication.formVersion.verify) fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증 공급자 확인이 필요합니다.");
  const questions = publication.formVersion.questions;
  validateDocumentConsents(publication.formVersion, input.documentConsents);
  const answers = validateAnswers(questions, input.answers);
  if (publication.formVersion.consentRequired && !input.consent) fail(422, "CONSENT_REQUIRED", "개인정보 수집·이용 동의가 필요합니다.");
  if (input.marketingConsent) fail(422, "MARKETING_PURPOSE_REQUIRED", "별도의 광고성 정보 수신동의 항목이 필요합니다.");
  return idempotent("submission:" + publication.id, key, input, async tx => {
    const live = await lockFilePublication(tx, publication.id, true);
    if (live.formVersionId !== publication.formVersionId) fail(410, "PUBLICATION_CLOSED", "게시 버전이 변경되었습니다. 폼을 다시 열어주세요.");
    await tx.publication.update({ where: { id: live.id }, data: { responseCount: { increment: 1 } } });
    // 폼에 보유 기간이 없으면 제출 시점의 회사 기본 보유 기간을 적용한다. 정책 변경은 다음 제출부터 반영된다.
    const policyDays = await companyRetentionDays(tx, live.tenantId);
    const retentionDays = publication.formVersion.retentionDays ?? policyDays;
    const retentionUntil = new Date(Date.now() + retentionDays * 86400000);
    const submission = await tx.submission.create({ data: {
      tenantId: live.tenantId, formVersionId: live.formVersionId, publicationId: live.id,
      retentionUntil, originalRetentionUntil: retentionUntil,
    } });
    await attachPublicFiles(tx, { tenantId: live.tenantId, serviceId: live.form.serviceId, formVersionId: live.formVersionId,
      publicationId: live.id, submissionId: submission.id, questions }, answers, input.attachments, requestId);
    await tx.answer.createMany({ data: questions.map(question => ({
        tenantId: live.tenantId, formVersionId: live.formVersionId, questionId: question.id,
        submissionId: submission.id,
        valueType: question.type, valueCipher: encrypt(answers[question.stableKey]),
      })) });
    await bindSubmissionSubject(tx, submission.id, live.form.serviceId, questions, answers);
    await collectMarketing(tx, submission, live.form.serviceId, publication.formVersion.marketing, input.marketingChannels ?? []);
    await createConsentReceipt(tx, publication.formVersion, submission.id, input.consent, input.documentConsents ?? [], policyDays);
    await tx.auditEvent.create({ data: {
      tenantId: live.tenantId, action: "submission.created", resource: "submission", resourceId: submission.id,
      serviceId: live.form.serviceId, requestId, detail: { formId: live.formId },
    } });
    await emitNotificationEvent(tx, "submission.created", submission.id);
    return { status: 201, body: { id: submission.id, submittedAt: submission.submittedAt.toISOString(), status: submission.status },
      resource: { tenantId: live.tenantId, resourceType: "submission", resourceId: submission.id } };
  }, tx => lockPublicPublication(tx, publication.id));
}
export async function listSubmissions(ctx: Context, formId: string, page: number, pageSize: number, requestId: string, input: SubmissionFilters = submissionFilters.parse({})) {
  return db.$transaction(async tx => {
  const form = await lockResponseForm(tx, ctx, formId);
  const mayReadFiles = await canReadFiles(tx, ctx, form.serviceId);
  const where = responseWhere(ctx, formId, input), total = await tx.submission.count({ where });
  page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const ids = await tx.submission.findMany({ where, select: { id: true },
    orderBy: [{ submittedAt: "desc" }, { id: "asc" }], take: pageSize, skip: (page - 1) * pageSize });
  await lockResponseRows(tx, ctx.tenantId, ids.map(row => row.id));
  const items = await tx.submission.findMany({ where: { ...where, id: { in: ids.map(row => row.id) } }, include: { answers: { include: { question: { select: { stableKey: true, label: true, type: true, matrixRows: true } } } },
      files: { where: { status: "attached", scanStatus: "clean" }, include: { question: { select: { stableKey: true } } } } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
  await audit(tx, ctx, requestId, "submission.list_viewed", "form", formId, [], form.serviceId);
  return { items: items.map(item => ({
    id: item.id, version: item.version, formVersionId: item.formVersionId, status: item.status, created: item.submittedAt,
    retentionUntil: item.retentionUntil, legalHold: item.legalHold,
    contentAvailable: submissionDataAvailable(item),
    values: submissionDataAvailable(item) ? Object.fromEntries(item.answers.map(answer => [answer.question.stableKey, decrypt(answer.valueCipher)])) : {},
    questions: item.answers.map(answer => ({ id: answer.question.stableKey, label: answer.question.label, type: answer.question.type,
      ...(answer.question.matrixRows ? { rows: rowSchema.array().parse(answer.question.matrixRows) } : {}) })),
    attachments: mayReadFiles && submissionDataAvailable(item) ? item.files.map(fileInfo) : [],
  })), total, page, pageSize };
  }, { timeout: 15000 });
}
