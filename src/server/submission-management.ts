import { suppressSubmission } from "./suppression";
import { eraseMarketingJobs } from "./marketing-jobs";
import { bindSubmissionSubject } from "./subject-identity";
import { readConsentEvidence } from "./consent-receipts";
import { z } from "zod";
import { db, type Transaction } from "./db";
import { type Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { contentDto } from "./forms";
import { validateAnswers, type Answers } from "./answer-validation";
import { submissionInput } from "@/contracts/domains";
import { attachCorrectionFiles } from "./file-bindings";
import { assertFileDeadlines, canReadFiles, fileInfo, lockFileContext, lockFileSubmission } from "./file-access";
import { lockSubmission, requireSubmissionContent } from "./submission-access";
import { submissionDataAvailable } from "@/contracts/destruction";
import { createDestruction } from "./destruction";

export const correctionInput = z.object({
  version: z.number().int().positive(), reason: z.string().trim().min(1).max(1000),
  answers: submissionInput.shape.answers.refine(value => Object.keys(value).length > 0, "정정할 답변을 입력해주세요."),
}).strict();
export const actionInput = z.object({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).strict();
export const noteInput = z.object({ text: z.string().trim().min(1).max(5000) }).strict();
function answerValues(row: Awaited<ReturnType<typeof lockSubmission>>) {
  return Object.fromEntries(row.formVersion.questions.map(question => [question.stableKey,
    row.status === "destroyed" ? "" : decrypt<Answers[string]>(row.answers.find(answer => answer.questionId === question.id)!.valueCipher)]));
}
type CorrectionSnapshot = { answers: Answers; reason: string };
async function recordChange(tx: Transaction, ctx: Context, id: string, reason: string, code: string, before: Answers, after: Answers) {
  const event = await tx.correction.create({ data: { tenantId: ctx.tenantId, submissionId: id, actorId: ctx.user.id,
    reason: code, changedFields: Object.keys(after), beforeHash: tokenHash(JSON.stringify(before)) } });
  await tx.correctionPayload.create({ data: { tenantId: ctx.tenantId, correctionId: event.id,
    beforeCipher: encrypt({ answers: before, reason }), afterCipher: encrypt(after) } });
}
export async function getSubmission(ctx: Context, id: string, requestId: string) {
  return db.$transaction(async tx => {
  const row = await lockSubmission(tx, ctx, id, "submission.read");
  const available = submissionDataAvailable(row);
  const importEvidence = available && row.importJobId ? await tx.importEvidence.findUnique({ where: { submissionId: id } }) : null;
  const corrections = available ? await tx.correction.findMany({ where: { tenantId: ctx.tenantId, submissionId: id }, include: { payload: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }) : [];
  const notes = available ? await tx.submissionNote.findMany({ where: { tenantId: ctx.tenantId, submissionId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  const receipts = available ? await tx.consentReceipt.findMany({ where: { tenantId: ctx.tenantId, submissionId: id }, include: { events: { orderBy: { createdAt: "asc" } } } }) : [];
  const mayReadFiles = await canReadFiles(tx, ctx, row.formVersion.form.serviceId);
  const attachments = mayReadFiles && available ?
    await tx.fileObject.findMany({ where: { tenantId: ctx.tenantId, submissionId: id, status: "attached", scanStatus: "clean" },
      include: { question: { select: { stableKey: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  await audit(tx, ctx, requestId, "submission.viewed", "submission", id, [], row.formVersion.form.serviceId);
  return {
    source: row.importJobId ? "csv" : "form", importEvidence: importEvidence ? decrypt(importEvidence.payloadCipher) : null,
    id: row.id, formId: row.formVersion.form.id, title: row.formVersion.title, version: row.version, status: row.status,
    createdAt: row.submittedAt, retentionUntil: row.retentionUntil, legalHold: row.legalHold,
    originalRetentionUntil: row.originalRetentionUntil, contentAvailable: available,
    values: available ? answerValues(row) : {},
    questions: contentDto(row.formVersion).questions,
    attachments: attachments.map(fileInfo),
    corrections: corrections.map(item => ({ id: item.id, reason: item.payload && row.status !== "destroyed" ? decrypt<CorrectionSnapshot>(item.payload.beforeCipher).reason : item.reason, actorId: item.actorId, createdAt: item.createdAt,
      changedFields: item.changedFields, beforeHash: item.beforeHash,
      before: item.payload && row.status !== "destroyed" ? decrypt<CorrectionSnapshot>(item.payload.beforeCipher).answers : null,
      after: item.payload && row.status !== "destroyed" ? decrypt<Answers>(item.payload.afterCipher) : null })),
    notes: notes.map(item => ({ id: item.id, text: decrypt<string>(item.textCipher), version: item.version, actorId: item.actorId, createdAt: item.createdAt })),
    receipts: receipts.map(item => ({ id: item.id, purpose: item.purpose, retentionDays: item.retentionDays, grantedAt: item.grantedAt,
      documentHash: item.documentHash, pdfHash: item.pdfHash, pdfAvailable: item.evidenceVersion === 1 && !!item.pdfCipher, evidence: readConsentEvidence(item),
      events: item.events.map(event => ({ type: event.type, reason: event.reason, createdAt: event.createdAt })) })),
  };
  });
}
export async function correctSubmission(ctx: Context, id: string, input: z.infer<typeof correctionInput>, requestId: string) {
  return db.$transaction(async tx => {
  const row = await lockSubmission(tx, ctx, id, "submission.write", true);
  requireSubmissionContent(row);
  if (row.legalHold) fail(409, "LEGAL_HOLD", "보존 조치 중에는 응답을 정정할 수 없습니다.");
  const evidence = row.importJobId ? await tx.importEvidence.findUnique({ where: { submissionId: id } }) : null;
  const fieldTypes = evidence ? decrypt<{ fieldTypes: string[] }>(evidence.payloadCipher).fieldTypes : [];
  const before = answerValues(row);
  const normalized = validateAnswers(row.formVersion.questions.map((q, i) => ({ ...q, validationKind: fieldTypes?.[i] })), input.answers, true, before);
  const changedAnswers = Object.fromEntries(Object.entries(normalized).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
  if (!Object.keys(changedAnswers).length) fail(422, "NO_CHANGES", "변경된 답변이 없습니다.");
    const hasFileChanges = row.formVersion.questions.some(question => question.type === "파일 업로드" && question.stableKey in changedAnswers);
    if (hasFileChanges) {
      if (!row.publicationId) fail(409, "IMPORT_ATTACHMENT", "CSV 수집 응답에는 첨부파일을 추가할 수 없습니다.");
      await lockFileContext(tx, ctx, row.formVersion.form.serviceId, ["submission.write", "file.read"]);
      await lockFileSubmission(tx, ctx.tenantId, id, true);
    }
    const changed = await tx.submission.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ["submitted", "corrected"] } },
      data: { status: "corrected", version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "응답이 변경되었거나 정정할 수 없는 상태입니다.");
    if (hasFileChanges) await attachCorrectionFiles(tx, ctx, { tenantId: ctx.tenantId, submissionId: id,
      publicationId: row.publicationId!, formVersionId: row.formVersionId, serviceId: row.formVersion.form.serviceId,
      questions: row.formVersion.questions }, changedAnswers, requestId);
    for (const question of row.formVersion.questions) if (question.stableKey in changedAnswers) {
      await tx.answer.updateMany({ where: { tenantId: ctx.tenantId, submissionId: id, questionId: question.id },
        data: { valueCipher: encrypt(changedAnswers[question.stableKey]) } });
    }
    const erasedMarketing = await tx.marketingPreference.findMany({ where: { sourceSubmissionId: id, status: "erased" }, select: { id: true } });
    if (erasedMarketing.length) await eraseMarketingJobs(tx, { marketingPreferenceId: { in: erasedMarketing.map(r => r.id) } });
    await bindSubmissionSubject(tx, id, row.formVersion.form.serviceId, row.formVersion.questions, { ...before, ...changedAnswers });
    const beforeChanged = Object.fromEntries(Object.keys(changedAnswers).map(key => [key, before[key]]));
    await recordChange(tx, ctx, id, input.reason, "answers_corrected", beforeChanged, changedAnswers);
    await audit(tx, ctx, requestId, "submission.corrected", "submission", id, Object.keys(changedAnswers), row.formVersion.form.serviceId);
    return { id, version: input.version + 1, status: "corrected" };
  });
}
export async function changeSubmission(ctx: Context, id: string, action: "withdraw" | "destruction-request" | "hold", input: z.infer<typeof actionInput> & { hold?: boolean }, requestId: string) {
  return db.$transaction(async tx => {
    const row = await lockSubmission(tx, ctx, id, action === "withdraw" ? "submission.write" : "submission.destroy", true);
    const deadlines = await lockFileContext(tx, ctx, row.formVersion.form.serviceId, [action === "withdraw" ? "submission.write" : "submission.destroy"], true);
    const current = row;
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "응답이 변경되었습니다. 다시 불러와주세요.");
    if (["destroying", "destroyed"].includes(current.status)) fail(409, "DESTRUCTION_STARTED", "파기가 시작된 응답은 변경할 수 없습니다.");
    if (action === "destruction-request" && current.legalHold) fail(409, "LEGAL_HOLD", "보존 조치 중인 응답은 파기 요청을 할 수 없습니다.");
    if (action !== "hold" && !["submitted", "corrected", ...(action === "destruction-request" ? ["withdrawn"] : [])].includes(current.status)) fail(409, "INVALID_TRANSITION", "요청할 수 없는 응답 상태입니다.");
    const status = action === "withdraw" ? "withdrawn" : action === "destruction-request" ? "pendingDestruction" : current.status;
    const destruction = action === "destruction-request" ? await createDestruction(tx, ctx, row, row.formVersion.form.serviceId, input.reason) : null;
    await tx.submission.update({ where: { id }, data: { status, version: { increment: 1 }, ...(action === "hold" ? { legalHold: input.hold } : {}) } });
    if (action === "withdraw") {
      await suppressSubmission(tx, id, "administrator_withdrawal");
      const receipts = await tx.consentReceipt.findMany({ where: { tenantId: ctx.tenantId, submissionId: id }, select: { id: true } });
      await tx.consentEvent.createMany({ data: receipts.map(receipt => ({ tenantId: ctx.tenantId, receiptId: receipt.id, type: "withdrawn", reason: "administrator_request" })) });
    }
    await recordChange(tx, ctx, id, input.reason, action,
      action === "hold" ? { legalHold: String(current.legalHold) } : { status: current.status },
      action === "hold" ? { legalHold: String(input.hold) } : { status });
    await audit(tx, ctx, requestId, "submission." + action, "submission", id, [action === "hold" ? "legalHold" : "status"], row.formVersion.form.serviceId);
    assertFileDeadlines(deadlines);
    return { id, version: current.version + 1, status, legalHold: action === "hold" ? input.hold : current.legalHold, ...(destruction ? { destructionId: destruction.id } : {}) };
  });
}
export async function createNote(ctx: Context, submissionId: string, input: z.infer<typeof noteInput>, requestId: string, tx: Transaction) {
  const row = await lockSubmission(tx, ctx, submissionId, "submission.write", true);
  requireSubmissionContent(row);
  const note = await tx.submissionNote.create({ data: { tenantId: ctx.tenantId, submissionId, actorId: ctx.user.id, textCipher: encrypt(input.text) } });
  await audit(tx, ctx, requestId, "submission.note_created", "submission", submissionId, ["note"], row.formVersion.form.serviceId);
  return { id: note.id, version: note.version, text: input.text, createdAt: note.createdAt };
}
export async function mutateNote(ctx: Context, submissionId: string, noteId: string, input: { version: number; text?: string }, requestId: string) {
  return db.$transaction(async tx => {
  const row = await lockSubmission(tx, ctx, submissionId, "submission.write", true);
  requireSubmissionContent(row);
  if (row.legalHold) fail(409, "LEGAL_HOLD", "보존 조치 중인 응답의 기존 메모는 변경할 수 없습니다.");
  const note = await tx.submissionNote.findFirst({ where: { id: noteId, submissionId, tenantId: ctx.tenantId } });
  if (!note) fail(404, "NOT_FOUND", "메모를 찾을 수 없습니다.");
    const where = { id: noteId, tenantId: ctx.tenantId, submissionId, version: input.version };
    const changed = input.text !== undefined ?
      await tx.submissionNote.updateMany({ where, data: { textCipher: encrypt(input.text), version: { increment: 1 } } }) :
      await tx.submissionNote.deleteMany({ where });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "메모가 변경되었습니다. 다시 불러와주세요.");
    await audit(tx, ctx, requestId, input.text === undefined ? "submission.note_deleted" : "submission.note_updated", "submission", submissionId, ["note"], row.formVersion.form.serviceId);
    return { id: noteId, version: input.version + 1 };
  });
}
