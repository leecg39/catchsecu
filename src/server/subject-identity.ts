import { normalizeSubjectEmail, normalizeSubjectName } from "@/contracts/subjects";
import { encrypt, tokenHash } from "./crypto";
import type { Transaction } from "./db";
import type { Answers } from "./answer-validation";
import { fail } from "./http";
import { assertQuota } from "./entitlements";
export function subjectHashes(name: string, email: string) {
  const normalized = { name: normalizeSubjectName(name), email: normalizeSubjectEmail(email) };
  return { normalized, nameHash: tokenHash("subject:name:" + normalized.name), emailHash: tokenHash("subject:email:" + normalized.email),
    identityHash: tokenHash("subject:identity:" + JSON.stringify([normalized.name, normalized.email])) };
}
async function identityLocks(tx: Transaction, tenantId: string, serviceId: string, hashes: string[]) {
  for (const hash of [...new Set(hashes)].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"subject:" + tenantId + ":" + serviceId + ":" + hash}, 0))`;
}
async function removeOrphan(tx: Transaction, id: string | null) {
  return id ? (await tx.dataSubject.deleteMany({ where: { id, submissions: { none: {} } } })).count : 0;
}
/** Call only while holding this submission's write lock, or just after creating it in this transaction. */
export async function bindSubmissionSubject(tx: Transaction, submissionId: string, serviceId: string,
  questions: { stableKey: string; subjectRole?: string | null }[], answers: Answers) {
  const submission = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { subject: true } });
  if (["destroying", "destroyed"].includes(submission.status)) fail(409, "SUBJECT_UNAVAILABLE", "파기 중인 응답의 식별 정보를 변경할 수 없습니다.");
  const nameQuestion = questions.find(q => q.subjectRole === "name"), emailQuestion = questions.find(q => q.subjectRole === "email");
  const contact = nameQuestion && emailQuestion ? subjectHashes(String(answers[nameQuestion.stableKey] ?? ""), String(answers[emailQuestion.stableKey] ?? "")) : null;
  await identityLocks(tx, submission.tenantId, serviceId, [submission.subject?.identityHash, contact?.identityHash].filter((v): v is string => !!v));
  if (contact && !await tx.dataSubject.findUnique({ where: { tenantId_serviceId_identityHash: { tenantId: submission.tenantId, serviceId, identityHash: contact.identityHash } } }))
    await assertQuota(tx, submission.tenantId, "subjects");
  const next = contact ? await tx.dataSubject.upsert({ where: { tenantId_serviceId_identityHash: { tenantId: submission.tenantId, serviceId, identityHash: contact.identityHash } }, update: {},
    create: { tenantId: submission.tenantId, serviceId, identityHash: contact.identityHash, nameHash: contact.nameHash, emailHash: contact.emailHash, contactCipher: encrypt(contact.normalized) } }) : null;
  if (submission.subjectId !== (next?.id ?? null)) {
    await tx.submission.update({ where: { id: submissionId }, data: { subjectId: next?.id ?? null } });
    await removeOrphan(tx, submission.subjectId);
  }
  return next?.id ?? null;
}
/** Erase the link before the terminal destroyed state; preserve subjects still linked to other records. */
export async function detachSubmissionSubject(tx: Transaction, submissionId: string) {
  const submission = await tx.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { subject: true } });
  if (!submission.subject) return { subjectBindings: 0, dataSubjects: 0 };
  await identityLocks(tx, submission.tenantId, submission.subject.serviceId, [submission.subject.identityHash]);
  await tx.submission.update({ where: { id: submissionId }, data: { subjectId: null } });
  return { subjectBindings: 1, dataSubjects: await removeOrphan(tx, submission.subject.id) };
}
