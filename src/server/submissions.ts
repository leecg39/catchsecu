import { emitNotificationEvent } from "./notifications";
import { collectMarketing } from "./marketing";
import { bindSubmissionSubject } from "./subject-identity";
import { consentBundle } from "./form-documents";
import { createConsentReceipt, validateDocumentConsents } from "./consent-receipts";
import { validateAnswers } from "./answer-validation";
import { attachPublicFiles } from "./file-bindings";
import { canReadFiles, fileInfo, lockFilePublication, lockFileContext } from "./file-access";
import { submissionDataAvailable } from "@/contracts/destruction";
import { z } from "zod";
import { db } from "./db";
import { type Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { idempotent } from "./idempotency";
import { contentDto, requireForm, versionInclude } from "./forms";
import { submissionInput } from "@/contracts/domains";

export async function activePublication(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  const publication = await db.publication.findUnique({ where: { tokenHash: tokenHash(token) }, include: {
    formVersion: { include: versionInclude }, form: { include: { service: { include: { tenant: { select: { status: true } } } } } },
  } });
  if (!publication) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  if (publication.status !== "active" || publication.form.status !== "published" ||
    publication.form.service.status !== "active" || publication.form.service.tenant.status !== "active" ||
    (publication.expiresAt && publication.expiresAt <= new Date())) fail(410, "PUBLICATION_CLOSED", "종료되었거나 만료된 폼입니다.");
  return publication;
}
export async function publicForm(token: string) {
  const publication = await activePublication(token);
  const { documentConsents: _selections, ...content } = contentDto(publication.formVersion); void _selections;
  return { title: publication.formVersion.title, content, consentBundle: consentBundle(publication.formVersion),
    closed: publication.responseCount >= publication.maxResponses, expiresAt: publication.expiresAt };
}
export async function submitForm(token: string, input: z.infer<typeof submissionInput>, key: string | null, requestId: string) {
  const publication = await activePublication(token);
  if (publication.formVersion.verify) fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증 공급자 확인이 필요합니다.");
  const questions = publication.formVersion.questions;
  validateDocumentConsents(publication.formVersion, input.documentConsents);
  validateAnswers(questions, input.answers);
  if (publication.formVersion.consentRequired && !input.consent) fail(422, "CONSENT_REQUIRED", "개인정보 수집·이용 동의가 필요합니다.");
  if (input.marketingConsent) fail(422, "MARKETING_PURPOSE_REQUIRED", "별도의 광고성 정보 수신동의 항목이 필요합니다.");
  return idempotent("submission:" + publication.id, key, input, async tx => {
    await lockFilePublication(tx, publication.id, true);
    await tx.$queryRaw`SELECT id FROM "Publication" WHERE id=${publication.id} FOR UPDATE`;
    const live = await tx.publication.findUniqueOrThrow({ where: { id: publication.id }, include: { form: { include: { service: { include: { tenant: true } } } } } });
    if (live.status !== "active" || live.form.status !== "published" || live.form.service.status !== "active" ||
      live.form.service.tenant.status !== "active" || (live.expiresAt && live.expiresAt <= new Date())) fail(410, "PUBLICATION_CLOSED", "폼이 종료되었습니다.");
    if (live.responseCount >= live.maxResponses) fail(409, "RESPONSE_LIMIT_REACHED", "응답 접수가 마감되었습니다.");
    await tx.publication.update({ where: { id: live.id }, data: { responseCount: { increment: 1 } } });
    const retentionUntil = new Date(Date.now() + publication.formVersion.retentionDays * 86400000);
    const submission = await tx.submission.create({ data: {
      tenantId: live.tenantId, formVersionId: live.formVersionId, publicationId: live.id,
      retentionUntil, originalRetentionUntil: retentionUntil,
    } });
    await attachPublicFiles(tx, { tenantId: live.tenantId, serviceId: live.form.serviceId, formVersionId: live.formVersionId,
      publicationId: live.id, submissionId: submission.id, questions }, input.answers, input.attachments, requestId);
    await tx.answer.createMany({ data: questions.map(question => ({
        tenantId: live.tenantId, formVersionId: live.formVersionId, questionId: question.id,
        submissionId: submission.id,
        valueType: question.type, valueCipher: encrypt(input.answers[question.stableKey] ?? (question.type === "체크박스" ? [] : "")),
      })) });
    await bindSubmissionSubject(tx, submission.id, live.form.serviceId, questions, input.answers);
    await collectMarketing(tx, submission, live.form.serviceId, publication.formVersion.marketing, input.marketingChannels ?? []);
    await createConsentReceipt(tx, publication.formVersion, submission.id, input.consent, input.documentConsents ?? []);
    await tx.auditEvent.create({ data: {
      tenantId: live.tenantId, action: "submission.created", resource: "submission", resourceId: submission.id,
      serviceId: live.form.serviceId, requestId, detail: { formId: live.formId },
    } });
    await emitNotificationEvent(tx, "submission.created", submission.id);
    return { status: 201, body: { id: submission.id, submittedAt: submission.submittedAt.toISOString(), status: submission.status },
      resource: { tenantId: live.tenantId, resourceType: "submission", resourceId: submission.id } };
  });
}
export async function listSubmissions(ctx: Context, formId: string, page: number, pageSize: number, requestId: string) {
  const form = await requireForm(ctx, formId, "submission.read");
  return db.$transaction(async tx => {
  await lockFileContext(tx, ctx, form.serviceId, ["submission.read"], true);
  const mayReadFiles = await canReadFiles(tx, ctx, form.serviceId);
  const where = { tenantId: ctx.tenantId, formVersion: { formId } };
  const ids = await tx.submission.findMany({ where, select: { id: true },
    orderBy: [{ submittedAt: "desc" }, { id: "asc" }], take: pageSize, skip: (page - 1) * pageSize });
  for (const row of [...ids].sort((a, b) => a.id.localeCompare(b.id)))
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id=${row.id} FOR SHARE`;
  const items = await tx.submission.findMany({ where: { ...where, id: { in: ids.map(row => row.id) } }, include: { answers: { include: { question: { select: { stableKey: true, label: true, type: true } } } },
      files: { where: { status: "attached", scanStatus: "clean" }, include: { question: { select: { stableKey: true } } } } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
  const total = await tx.submission.count({ where });
  await audit(tx, ctx, requestId, "submission.list_viewed", "form", formId, [], form.serviceId);
  return { items: items.map(item => ({
    id: item.id, version: item.version, formVersionId: item.formVersionId, status: item.status, created: item.submittedAt,
    retentionUntil: item.retentionUntil, legalHold: item.legalHold,
    contentAvailable: submissionDataAvailable(item),
    values: submissionDataAvailable(item) ? Object.fromEntries(item.answers.map(answer => [answer.question.stableKey, decrypt(answer.valueCipher)])) : {},
    questions: item.answers.map(answer => ({ id: answer.question.stableKey, label: answer.question.label, type: answer.question.type })),
    attachments: mayReadFiles && submissionDataAvailable(item) ? item.files.map(fileInfo) : [],
  })), total, page, pageSize };
  }, { timeout: 15000 });
}
