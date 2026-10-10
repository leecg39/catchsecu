import { emitNotificationEvent } from "./notifications";
import { collectMarketing } from "./marketing";
import { bindSubmissionSubject } from "./subject-identity";
import { consentBundle } from "./form-documents";
import { createConsentReceipt, validateDocumentConsents } from "./consent-receipts";
import { validateAnswers } from "./answer-validation";
import { storedOptionDefinitions } from "./question-options";
import { rowSchema, type AnswerValue } from "@/contracts/questions";
import { submissionFilters, type SubmissionFilters } from "@/contracts/submissions";
import { lockResponseForm, lockResponseRows, responseWhere } from "./submission-query";
import { attachPublicFiles } from "./file-bindings";
import { canReadFiles, fileInfo, lockFilePublication, readableAnswerValues } from "./file-access";
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
import { lockPublicPublication, lockPublicPublicationView } from "./public-publication";
import { consumeVerificationReceipt } from "./verification-flow";
import { resolveFormVisit } from "@/contracts/form-sections";
import { issueCompletionProof } from "./form-notice-access";
import { requireParticipationSession, storedParticipationPolicy } from "./participation-access";

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
export async function publicForm(token: string, participationProof?: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
  return db.$transaction(async tx => {
    const initial = await tx.publication.findUnique({ where: { tokenHash: tokenHash(token) }, select: { id: true } });
    if (!initial) fail(404, "NOT_FOUND", "공개 폼을 찾을 수 없습니다.");
    const view = await lockPublicPublicationView(tx, initial.id);
    const publication = await tx.publication.findUniqueOrThrow({ where: { id: initial.id }, include: {
      formVersion: { include: versionInclude }, form: { include: { service: { include: { tenant: { select: { status: true } } } } } },
    } });
    const full = contentDto(publication.formVersion);
    const closed = (closedReason: "paused" | "expired" | "response_limit") => ({ title: publication.formVersion.title, closed: true as const, closedReason,
      ...(full.formLanguage ? { formLanguage: full.formLanguage } : {}),
      ...(full.closedPage ? { closedPage: full.closedPage } : {}), expiresAt: publication.expiresAt });
    if (view.state === "scheduled") return { title: publication.formVersion.title, closed: true as const, scheduled: true as const,
      ...(full.formLanguage ? { formLanguage: full.formLanguage } : {}), opensAt: publication.opensAt!, expiresAt: publication.expiresAt,
      closedPage: undefined };
    if (view.state === "closed") return closed(view.closedReason);
    const participationAccess = storedParticipationPolicy(publication.formVersion);
    if (participationAccess.enabled && !participationProof) return {
      title: publication.formVersion.title, closed: true as const, accessRequired: true as const,
      ...(full.formLanguage ? { formLanguage: full.formLanguage } : {}),
      expiresAt: publication.expiresAt,
      access: participationAccess,
      closedPage: undefined,
    };
    if (participationAccess.enabled) await requireParticipationSession(tx, publication, participationProof);
    const { documentConsents: _selections, completionPage: _completion, closedPage: _closed, ...content } = full;
    void _selections; void _completion; void _closed;
    // Manual classification is administrator metadata, not a public form field.
    content.questions = content.questions.map(({ catchFormPersonalInformationRequests: _classification, ...question }) => {
      void _classification; return question;
    });
    if (content.retentionDays === null) {
      const designated = publication.form.designatedRetentionDays;
      if (designated !== null) content.retentionDays = designated;
      else {
        const rule = await tx.retentionRule.findUnique({ where: { tenantId_serviceId: { tenantId: publication.tenantId, serviceId: publication.form.serviceId }, status: "active" }, select: { retentionDays: true } });
        if (rule) content.retentionDays = rule.retentionDays;
        else {
          const policy = await tx.securityPolicy.findUnique({ where: { tenantId: publication.tenantId }, select: { retentionDays: true } });
          if (!policy) fail(409, "POLICY_REQUIRED", "회사 보안 정책이 없습니다.");
          content.retentionDays = policy.retentionDays;
        }
      }
    }
    let verification: { kinds: ("identity" | "signature")[] } | undefined;
    if (content.verify) {
      const integration = await tx.verificationIntegration.findUnique({
        where: { tenantId_serviceId: { tenantId: publication.tenantId, serviceId: publication.form.serviceId } } });
      const kinds: ("identity" | "signature")[] = [];
      if (integration?.status === "enabled") {
        if (integration.identityProvider === "local" && integration.environment === "sandbox") kinds.push("identity");
        if (integration.signatureProvider === "local" && integration.environment === "sandbox") kinds.push("signature");
      }
      verification = { kinds };
    }
    const final = await lockPublicPublicationView(tx, publication.id);
    if (final.state === "closed") return closed(final.closedReason);
    return { title: publication.formVersion.title, content, consentBundle: consentBundle(publication.formVersion),
      closed: false as const, expiresAt: publication.expiresAt, verification };
  }, { timeout: 15000 });
}
export async function submitForm(token: string, input: z.infer<typeof submissionInput>, key: string | null, requestId: string) {
  const publication = await activePublication(token);
  const participationPolicy = storedParticipationPolicy(publication.formVersion);
  if (participationPolicy.enabled && !input.participationProof) fail(401, "PARTICIPATION_AUTH_REQUIRED", "참여 인증을 완료해주세요.");
  const completionPage = contentDto(publication.formVersion).completionPage;
  if (publication.formVersion.verify && !input.verification) {
    const integration = await db.verificationIntegration.findUnique({
      where: { tenantId_serviceId: { tenantId: publication.tenantId, serviceId: publication.form.serviceId } } });
    if (!integration || integration.status !== "enabled" || !(integration.identityProvider || integration.signatureProvider))
      fail(503, "IDENTITY_PROVIDER_REQUIRED", "본인인증·전자서명 공급자 확인이 필요합니다.");
    fail(422, "VERIFICATION_REQUIRED", "본인인증·전자서명 영수증이 필요합니다.");
  }
  const questions = publication.formVersion.questions;
  validateDocumentConsents(publication.formVersion, input.documentConsents);
  const visit = resolveFormVisit(contentDto(publication.formVersion), input.answers);
  if (visit?.terminal === "ineligible") fail(422, "INELIGIBLE_PATH", "참여 대상이 아닌 경로에서는 응답을 제출할 수 없습니다.");
  const answers = validateAnswers(questions, input.answers, false, undefined, publication.formVersion.formLanguage, visit?.questionIds);
  if (publication.formVersion.consentRequired && !input.consent) fail(422, "CONSENT_REQUIRED", "개인정보 수집·이용 동의가 필요합니다.");
  if (input.marketingConsent) fail(422, "MARKETING_PURPOSE_REQUIRED", "별도의 광고성 정보 수신동의 항목이 필요합니다.");
  return idempotent("submission:" + publication.id, key, input, async tx => {
    const live = await lockFilePublication(tx, publication.id, true);
    if (live.formVersionId !== publication.formVersionId) fail(410, "PUBLICATION_CLOSED", "게시 버전이 변경되었습니다. 폼을 다시 열어주세요.");
    const participation = await requireParticipationSession(tx, live, input.participationProof, { write: true });
    await tx.publication.update({ where: { id: live.id }, data: { responseCount: { increment: 1 } } });
    // 폼에 보유 기간이 없으면 제출 시점의 회사 기본 보유 기간을 적용한다. 정책 변경은 다음 제출부터 반영된다.
    const policyDays = await companyRetentionDays(tx, live.tenantId, live.form.serviceId);
    const retentionDays = live.formVersion.retentionDays ?? live.form.designatedRetentionDays ?? policyDays;
    const retentionUntil = new Date(Date.now() + retentionDays * 86400000);
    const submission = await tx.submission.create({ data: {
      tenantId: live.tenantId, formVersionId: live.formVersionId, publicationId: live.id,
      ...(participation ? { participantId: participation.participant.id } : {}),
      retentionUntil, originalRetentionUntil: retentionUntil,
      ...(visit ? { pagePathVersion: 1, visitedPageKeys: visit.pageIds, terminationKind: visit.terminal } : {}),
    } });
    await attachPublicFiles(tx, { tenantId: live.tenantId, serviceId: live.form.serviceId, formVersionId: live.formVersionId,
      publicationId: live.id, submissionId: submission.id, questions }, answers, input.attachments, requestId);
    await tx.answer.createMany({ data: questions.map(question => ({
        tenantId: live.tenantId, formVersionId: live.formVersionId, questionId: question.id,
        submissionId: submission.id,
        valueType: question.type, valueCipher: encrypt(answers[question.stableKey]),
      })) });
    await consumeVerificationReceipt(tx, live, live.formVersion, input.verification, submission.id, requestId);
    await bindSubmissionSubject(tx, submission.id, live.form.serviceId, questions, answers);
    await collectMarketing(tx, submission, live.form.serviceId, publication.formVersion.marketing, input.marketingChannels ?? [], requestId);
    await createConsentReceipt(tx, publication.formVersion, submission.id, input.consent, input.documentConsents ?? [], retentionDays, visit);
    if (participation) await tx.publicationParticipant.update({ where: { id: participation.participant.id },
      data: { submissionCount: { increment: 1 }, lastSubmittedAt: submission.submittedAt } });
    await tx.auditEvent.create({ data: {
      tenantId: live.tenantId, action: "submission.created", resource: "submission", resourceId: submission.id,
      serviceId: live.form.serviceId, requestId, detail: { formId: live.formId },
    } });
    await emitNotificationEvent(tx, "submission.created", submission.id);
    return { status: 201, body: { id: submission.id, submittedAt: submission.submittedAt.toISOString(), status: "submitted" as const,
      ...(completionPage ? { completionPage } : {}), completionProof: issueCompletionProof(live.id, live.formVersionId, submission.id) },
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
  const items = await tx.submission.findMany({ where: { ...where, id: { in: ids.map(row => row.id) } }, include: { answers: { orderBy: { question: { order: "asc" } }, include: { question: { select: { stableKey: true, label: true, type: true, matrixRows: true, options: { orderBy: { order: "asc" } } } } } },
      files: { where: { status: "attached", scanStatus: "clean" }, include: { question: { select: { stableKey: true } } } } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
  await audit(tx, ctx, requestId, "submission.list_viewed", "form", formId, [], form.serviceId);
  return { items: items.map(item => ({
    id: item.id, version: item.version, formVersionId: item.formVersionId, status: item.status, created: item.submittedAt,
    ...(item.pagePathVersion === 1 ? { visitedPageIds: item.visitedPageKeys, terminationKind: item.terminationKind } : {}),
    retentionUntil: item.retentionUntil, legalHold: item.legalHold,
    contentAvailable: submissionDataAvailable(item),
    values: submissionDataAvailable(item) ? readableAnswerValues(Object.fromEntries(item.answers.map(answer => [answer.question.stableKey, decrypt<AnswerValue>(answer.valueCipher)])), mayReadFiles) : {},
    questions: item.answers.map(answer => ({ id: answer.question.stableKey, label: answer.question.label, type: answer.question.type, optionDefinitions: storedOptionDefinitions(answer.question.options),
      ...(answer.question.matrixRows ? { rows: rowSchema.array().parse(answer.question.matrixRows) } : {}) })),
    attachments: mayReadFiles && submissionDataAvailable(item) ? item.files.map(fileInfo) : [],
  })), total, page, pageSize };
  }, { timeout: 15000 });
}
