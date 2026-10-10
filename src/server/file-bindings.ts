import type { Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { decrypt, tokenHash } from "./crypto";
import { DRAWING_QUESTION_TYPE, fileAnswerId, isDrawingAnswer, isFileQuestion } from "@/contracts/drawing-questions";
import { audit } from "./audit";
import type { Answers } from "./answer-validation";
type Question = { id: string; stableKey: string; type: string };
type Binding = { tenantId: string; formVersionId: string; publicationId: string; submissionId: string; serviceId: string; questions: Question[] };
type Proofs = Record<string, { fileId: string; token: string }>;
async function candidates(tx: Transaction, binding: Binding, answers: Answers) {
  const selected = binding.questions.filter(question => isFileQuestion(question.type) && answers[question.stableKey]);
  const ids = selected.map(question => {
    const id = fileAnswerId(answers[question.stableKey]);
    if (!id) fail(422, "INVALID_ATTACHMENT", "첨부파일 식별자를 확인해주세요.");
    return id;
  }).sort();
  if (new Set(ids).size !== ids.length) fail(422, "DUPLICATE_ATTACHMENT", "하나의 파일을 여러 질문에 사용할 수 없습니다.");
  for (const id of ids) await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${id} AND "tenantId"=${binding.tenantId} FOR UPDATE`;
  const files = await tx.fileObject.findMany({ where: { tenantId: binding.tenantId, id: { in: ids } } });
  return selected.map(question => {
    const answer = answers[question.stableKey], file = files.find(item => item.id === fileAnswerId(answer));
    if (!file || file.serviceId !== binding.serviceId || file.publicationId !== binding.publicationId ||
      file.formVersionId !== binding.formVersionId || file.questionId !== question.id || file.scanStatus !== "clean")
      fail(422, "INVALID_ATTACHMENT", "응답과 질문에 연결된 검사 완료 파일을 첨부해주세요.");
    if (question.type === DRAWING_QUESTION_TYPE && (!isDrawingAnswer(answer) || file.mime !== "image/png" || !file.nameCipher ||
      answer.fileName !== decrypt<string>(file.nameCipher!) || answer.fileSize !== file.size))
      fail(422, "INVALID_DRAWING", "그림 파일과 제출한 파일 정보가 일치하지 않습니다.");
    return { question, file };
  });
}
export async function attachPublicFiles(tx: Transaction, binding: Binding, answers: Answers, proofs: Proofs | undefined, requestId: string) {
  const selected = await candidates(tx, binding, answers), supplied = proofs ?? {};
  if (Object.keys(supplied).some(id => !selected.some(item => item.question.stableKey === id)))
    fail(422, "INVALID_ATTACHMENT", "답변에 없는 파일의 업로드 권한이 포함되어 있습니다.");
  for (const { file, question } of selected) {
    const proof = supplied[question.stableKey];
    if (!proof || proof.fileId !== file.id || file.ownerKind !== "public" || file.submissionId !== null ||
      file.status !== "ready" || !file.expiresAt || file.expiresAt <= new Date() || file.uploadTokenHash !== tokenHash(proof.token))
      fail(422, "INVALID_ATTACHMENT", "파일의 업로드 권한이 없거나 만료되었습니다. 파일을 다시 첨부해주세요.");
    await tx.fileObject.update({ where: { id: file.id }, data: { submissionId: binding.submissionId,
      status: "attached", uploadTokenHash: null, expiresAt: null, version: { increment: 1 } } });
    await tx.auditEvent.create({ data: { tenantId: binding.tenantId, serviceId: binding.serviceId,
      action: "file.attached", resource: "file", resourceId: file.id, requestId, detail: { submissionId: binding.submissionId, questionId: question.id } } });
  }
}
export async function attachCorrectionFiles(tx: Transaction, ctx: Context, binding: Binding, answers: Answers, requestId: string) {
  for (const { file } of await candidates(tx, binding, answers)) {
    if (file.submissionId !== binding.submissionId) fail(422, "INVALID_ATTACHMENT", "다른 응답의 첨부파일을 사용할 수 없습니다.");
    // Previous attachments remain readable as correction evidence and may be restored.
    if (file.status === "attached") continue;
    if (file.ownerKind !== "member" || file.ownerId !== ctx.user.id || file.status !== "ready" || !file.expiresAt || file.expiresAt <= new Date())
      fail(422, "INVALID_ATTACHMENT", "파일의 업로드 권한이 없거나 만료되었습니다.");
    await tx.fileObject.update({ where: { id: file.id }, data: { status: "attached", expiresAt: null, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "file.attachment_corrected", "file", file.id, ["submissionId"], binding.serviceId);
  }
}
