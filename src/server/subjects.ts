import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, type SubjectSession } from "@/generated/prisma/client";
import type { z } from "zod";
import type { subjectAccessInput, subjectWithdrawalInput, SubjectConsent, SubjectEvent, SubjectPage, SubjectWithdrawalRecord } from "@/contracts/subjects";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { subjectHashes } from "./subject-identity";
import { enqueueMail } from "./jobs";
import { env } from "./env";
import { fail } from "./http";
import { suppressSubmission } from "./suppression";
import { lockSubjectScopes, retainedSubjectSubmission as retained } from "./subject-scope";
export const SUBJECT_COOKIE = "cs_subject", SUBJECT_BROWSER_COOKIE = "cs_subject_browser";
const secret = /^[A-Za-z0-9_-]{43}$/;
export function subjectCookie(request: Request, name = SUBJECT_COOKIE) {
  const value = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="))?.slice(name.length + 1);
  return value && secret.test(value) ? value : null;
}
export function setSubjectCookie(response: Response, name: string, value: string, seconds: number, request: Request) {
  response.headers.append("Set-Cookie", `${name}=${value}; Path=/api/v1/subjects; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(seconds))}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
}
function scoped(session: SubjectSession): Prisma.SubmissionWhereInput { return { ...retained(), subject: { accessScopes: { some: { requestId: session.requestId } } } }; }
const responseRetention = new WeakMap<SubjectSession, number>();
function assertSubjectDeadline(session: SubjectSession) {
  const now = Date.now();
  if (session.revokedAt || session.expiresAt.getTime() <= now) fail(401, "SUBJECT_SESSION_EXPIRED", "조회 시간이 만료되었습니다. 다시 이메일 인증을 완료해주세요.");
  if ((responseRetention.get(session) ?? Infinity) <= now) fail(404, "SUBJECT_RECORD_NOT_FOUND", "조회할 수 있는 동의 이력이 없습니다. 목록을 다시 불러와주세요.");
}
function retainResponse(session: SubjectSession, rows: { retentionUntil: Date }[]) {
  for (const row of rows) responseRetention.set(session, Math.min(responseRetention.get(session) ?? Infinity, row.retentionUntil.getTime()));
  assertSubjectDeadline(session);
}
function audit(tx: Transaction, requestId: string, tenantId: string, serviceId: string, action: string, resourceId: string, sessionId?: string) {
  return tx.auditEvent.create({ data: { tenantId, serviceId, requestId, action, resource: "subject", resourceId, detail: sessionId ? { sessionId } : {} } });
}
export async function requestSubjectAccess(input: z.infer<typeof subjectAccessInput>, existingBrowser: string | null, requestId: string) {
  const hashes = subjectHashes(input.name, input.email), token = opaqueToken(), browser = existingBrowser ?? opaqueToken();
  await db.$transaction(async tx => {
    const candidates = await tx.dataSubject.findMany({ where: { nameHash: hashes.nameHash, emailHash: hashes.emailHash, identityHash: hashes.identityHash, submissions: { some: retained() } }, orderBy: { id: "asc" } });
    if (!candidates.length) return;
    // Prevent orphan deletion between the lookup and its scope FK insertion. No submission locks follow.
    await tx.$queryRaw`SELECT id FROM "DataSubject" WHERE id IN (${Prisma.join(candidates.map(s => s.id))}) ORDER BY id FOR SHARE`;
    const subjects = await tx.dataSubject.findMany({ where: { id: { in: candidates.map(s => s.id) }, submissions: { some: retained() } } });
    if (!subjects.length) return;
    const access = await tx.subjectAccessRequest.create({ data: { tokenHash: tokenHash(token), browserHash: tokenHash(browser), expiresAt: new Date(Date.now() + 600000) } });
    await tx.subjectAccessScope.createMany({ data: subjects.map(s => ({ requestId: access.id, tenantId: s.tenantId, subjectId: s.id })) });
    // Use the verified stored address; never accept a separate recipient supplied by the browser.
    const contact = decrypt<{ name: string; email: string }>(subjects[0].contactCipher);
    await enqueueMail({ to: contact.email, subject: "동의 이력 조회 이메일 인증", text: "동의 이력 조회를 요청하셨습니다.\n\n" + env.BETTER_AUTH_URL + "/infoOwner/agree-history/" + token +
      "\n\n10분 이내에 요청한 브라우저에서 링크를 열고 이메일 인증을 완료해주세요. 이 링크는 한 번만 사용할 수 있습니다.\n요청하지 않았다면 이 메일을 무시해주세요." }, "subject-access:" + access.id, tx);
    for (const s of subjects) await audit(tx, requestId, s.tenantId, s.serviceId, "subject.access_requested", access.id);
  }, { timeout: 15000 });
  return { browser };
}
export async function createSubjectSession(token: string, browser: string | null) {
  if (!browser) fail(422, "SUBJECT_LINK_INVALID", "인증 링크를 사용할 수 없습니다. 조회를 요청한 브라우저에서 다시 시도해주세요.");
  return db.$transaction(async tx => {
    const initial = await tx.subjectAccessRequest.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!initial) fail(422, "SUBJECT_LINK_INVALID", "인증 링크가 만료되었거나 이미 사용되었습니다. 다시 조회를 요청해주세요.");
    await tx.$queryRaw`SELECT id FROM "SubjectAccessRequest" WHERE id=${initial.id} FOR UPDATE`;
    const access = await tx.subjectAccessRequest.findUniqueOrThrow({ where: { id: initial.id } });
    await lockSubjectScopes(tx, access.id);
    if (access.consumedAt || access.expiresAt <= new Date() || access.browserHash !== tokenHash(browser) ||
      !await tx.subjectAccessScope.count({ where: { requestId: access.id, subject: { submissions: { some: retained() } } } }))
      fail(422, "SUBJECT_LINK_INVALID", "인증 링크가 만료되었거나 사용할 수 없습니다. 조회를 요청한 브라우저에서 다시 요청해주세요.");
    await tx.subjectAccessRequest.update({ where: { id: access.id }, data: { consumedAt: new Date() } });
    const value = opaqueToken(), session = await tx.subjectSession.create({ data: { requestId: access.id, tokenHash: tokenHash(value), expiresAt: new Date(Date.now() + 1800000) } });
    const eligible = await tx.subjectAccessScope.count({ where: { requestId: access.id, subject: { submissions: { some: retained() } } } });
    if (access.expiresAt <= new Date() || session.expiresAt <= new Date() || !eligible)
      fail(422, "SUBJECT_LINK_INVALID", "인증 요청이 종료되었습니다. 다시 조회를 요청해주세요.");
    return { token: value, id: session.id, expiresAt: session.expiresAt.toISOString() };
  });
}
export async function withSubject<T>(token: string | null, id: string, operation: (tx: Transaction, session: SubjectSession) => Promise<T>) {
  if (!token) fail(401, "SUBJECT_AUTH_REQUIRED", "이메일 인증 후 동의 이력을 조회해주세요.");
  return db.$transaction(async tx => {
    const initial = await tx.subjectSession.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!initial || initial.id !== id) fail(401, "SUBJECT_AUTH_REQUIRED", "현재 인증에 해당하는 조회 링크를 이용해주세요.");
    await tx.$queryRaw`SELECT id FROM "SubjectSession" WHERE id=${id} FOR SHARE`;
    const session = await tx.subjectSession.findUniqueOrThrow({ where: { id } });
    assertSubjectDeadline(session);
    await lockSubjectScopes(tx, session.requestId);
    assertSubjectDeadline(session);
    const result = await operation(tx, session);
    assertSubjectDeadline(session);
    return result;
  }, { timeout: 15000 });
}
export async function logoutSubject(token: string | null) {
  if (token) await db.subjectSession.updateMany({ where: { tokenHash: tokenHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
const consentInclude = { formVersion: { include: { form: { include: { service: { include: { tenant: true } } } } } }, receipts: { include: { events: { where: { type: "withdrawn" }, orderBy: { createdAt: "asc" as const } } }, orderBy: { id: "asc" as const } } } as const;
async function lockRows(tx: Transaction, ids: string[], write = false) {
  if (!ids.length) return;
  if (write) await tx.$queryRaw`SELECT id FROM "Submission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Submission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
}
function consentDto(row: Prisma.SubmissionGetPayload<{ include: typeof consentInclude }>): SubjectConsent {
  return { id: row.id, version: row.version, company: row.formVersion.form.service.tenant.publicName, service: row.formVersion.form.service.externalName,
    title: row.formVersion.title, status: row.status, submittedAt: row.submittedAt.toISOString(), retentionUntil: row.retentionUntil.toISOString(),
    canWithdraw: ["submitted", "corrected"].includes(row.status), receipts: row.receipts.map(r => ({ id: r.id, purpose: r.purpose, grantedAt: r.grantedAt.toISOString(), retentionDays: r.retentionDays,
      documentHash: r.documentHash, withdrawnAt: r.events[0]?.createdAt.toISOString() ?? null })) };
}
export async function subjectConsents(tx: Transaction, session: SubjectSession, page: number, pageSize: number, requestId: string): Promise<SubjectPage<SubjectConsent>> {
  const total = await tx.submission.count({ where: scoped(session) });
  page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const selected = await tx.submission.findMany({ where: scoped(session), orderBy: [{ submittedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true } });
  await lockRows(tx, selected.map(s => s.id));
  const rows = await tx.submission.findMany({ where: { ...scoped(session), id: { in: selected.map(s => s.id) } }, include: consentInclude, orderBy: [{ submittedAt: "desc" }, { id: "asc" }] });
  retainResponse(session, rows);
  for (const row of rows) await audit(tx, requestId, row.tenantId, row.formVersion.form.serviceId, "subject.consents_viewed", row.id, session.id);
  const currentTotal = await tx.submission.count({ where: scoped(session) });
  assertSubjectDeadline(session);
  if (page > Math.max(1, Math.ceil(currentTotal / pageSize))) return subjectConsents(tx, session, Math.max(1, Math.ceil(currentTotal / pageSize)), pageSize, requestId);
  return { items: rows.map(consentDto), total: currentTotal, page, pageSize };
}
export async function subjectEvents(tx: Transaction, session: SubjectSession, page: number, pageSize: number, requestId: string): Promise<SubjectPage<SubjectEvent>> {
  const where = () => ({ type: { in: ["granted", "imported", "withdrawn"] }, receipt: { submission: scoped(session) } });
  const total = await tx.consentEvent.count({ where: where() });
  page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await tx.consentEvent.findMany({ where: where(), select: { id: true, receipt: { select: { submissionId: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
  await lockRows(tx, [...new Set(rows.map(r => r.receipt.submissionId))]);
  const events = await tx.consentEvent.findMany({ where: { ...where(), id: { in: rows.map(r => r.id) } }, include: { receipt: { include: { submission: { include: consentInclude } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  retainResponse(session, events.map(e => e.receipt.submission));
  for (const event of events) { const sub = event.receipt.submission; await audit(tx, requestId, sub.tenantId, sub.formVersion.form.serviceId, "subject.events_viewed", sub.id, session.id); }
  const currentTotal = await tx.consentEvent.count({ where: where() });
  assertSubjectDeadline(session);
  if (page > Math.max(1, Math.ceil(currentTotal / pageSize))) return subjectEvents(tx, session, Math.max(1, Math.ceil(currentTotal / pageSize)), pageSize, requestId);
  return { items: events.map(e => ({ id: e.id, type: e.type, createdAt: e.createdAt.toISOString(), submissionId: e.receipt.submissionId, title: e.receipt.submission.formVersion.title,
    company: e.receipt.submission.formVersion.form.service.tenant.publicName, service: e.receipt.submission.formVersion.form.service.externalName, purpose: e.receipt.purpose })),
    total: currentTotal, page, pageSize };
}
async function ownSubmission(tx: Transaction, session: SubjectSession, id: string, write: boolean) {
  // Do not lock a foreign record on an attacker-controlled UUID.
  if (!await tx.submission.count({ where: { ...scoped(session), id } })) fail(404, "SUBJECT_RECORD_NOT_FOUND", "조회할 수 있는 동의 이력이 없습니다.");
  await lockRows(tx, [id], write);
  const row = await tx.submission.findFirst({ where: { ...scoped(session), id }, include: consentInclude });
  if (!row) fail(404, "SUBJECT_RECORD_NOT_FOUND", "조회할 수 있는 동의 이력이 없습니다.");
  retainResponse(session, [row]);
  return row;
}
export async function requestWithdrawal(tx: Transaction, session: SubjectSession, input: z.infer<typeof subjectWithdrawalInput>, requestId: string) {
  const sub = await ownSubmission(tx, session, input.submissionId, true);
  if (!["submitted", "corrected"].includes(sub.status)) fail(409, "WITHDRAWAL_NOT_ALLOWED", "이미 철회되었거나 철회할 수 없는 상태입니다.");
  if (input.version !== sub.version) fail(409, "VERSION_CONFLICT", "동의 이력이 변경되었습니다. 다시 불러와주세요.");
  const existing = await tx.subjectWithdrawal.findFirst({ where: { sessionId: session.id, submissionId: sub.id, status: "requested" } });
  if (existing && existing.submissionVersion !== sub.version) await tx.subjectWithdrawal.update({ where: { id: existing.id }, data: { status: "cancelled", finishedAt: new Date() } });
  const row = existing?.submissionVersion === sub.version ? existing : await tx.subjectWithdrawal.create({ data: { tenantId: sub.tenantId, submissionId: sub.id, sessionId: session.id, submissionVersion: sub.version } });
  await audit(tx, requestId, sub.tenantId, sub.formVersion.form.serviceId, "subject.withdrawal_requested", row.id, session.id);
  return withdrawalDto(row, sub);
}
function withdrawalDto(row: { id: string; sessionId: string; status: string; createdAt: Date; finishedAt: Date | null }, sub: Prisma.SubmissionGetPayload<{ include: typeof consentInclude }>): SubjectWithdrawalRecord {
  return { id: row.id, sessionId: row.sessionId, status: row.status, createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    title: sub.formVersion.title, company: sub.formVersion.form.service.tenant.publicName, service: sub.formVersion.form.service.externalName };
}
export async function subjectWithdrawal(tx: Transaction, session: SubjectSession, id: string, action: "read" | "confirm" | "cancel", requestId: string) {
  const initial = await tx.subjectWithdrawal.findFirst({ where: { id, sessionId: session.id } });
  if (!initial) fail(404, "WITHDRAWAL_NOT_FOUND", "철회 요청을 찾을 수 없습니다.");
  const sub = await ownSubmission(tx, session, initial.submissionId, action !== "read");
  if (action !== "read") await tx.$queryRaw`SELECT id FROM "SubjectWithdrawal" WHERE id=${id} FOR UPDATE`;
  const row = await tx.subjectWithdrawal.findUniqueOrThrow({ where: { id } });
  if (action === "read") return withdrawalDto(row, sub);
  if (row.status !== "requested") {
    if ((action === "confirm" && row.status === "completed") || (action === "cancel" && row.status === "cancelled")) return withdrawalDto(row, sub);
    fail(409, "WITHDRAWAL_FINISHED", "이미 처리된 철회 요청입니다.");
  }
  if (action === "confirm") {
    if (sub.version !== row.submissionVersion || !["submitted", "corrected"].includes(sub.status)) fail(409, "VERSION_CONFLICT", "동의 이력이 변경되었습니다. 조회 화면에서 다시 철회를 요청해주세요.");
    await tx.submission.update({ where: { id: sub.id }, data: { status: "withdrawn", version: { increment: 1 } } });
    await tx.consentEvent.createMany({ data: sub.receipts.map(r => ({ tenantId: sub.tenantId, receiptId: r.id, type: "withdrawn", reason: "subject_request" })) });
    await suppressSubmission(tx, sub.id, "subject_withdrawal");
  }
  const changed = await tx.subjectWithdrawal.update({ where: { id }, data: { status: action === "confirm" ? "completed" : "cancelled", finishedAt: new Date() } });
  await audit(tx, requestId, sub.tenantId, sub.formVersion.form.serviceId, action === "confirm" ? "subject.withdrawn" : "subject.withdrawal_cancelled", sub.id, session.id);
  return withdrawalDto(changed, sub);
}
export async function cleanupSubjectAccess() {
  const cutoff = new Date(Date.now() - 86400000), old = await db.subjectAccessRequest.findMany({ where: { expiresAt: { lt: cutoff } }, take: 100, orderBy: { id: "asc" } });
  let count = 0;
  for (const candidate of old) count += await db.$transaction(async tx => {
    // The mail worker shares this row lock through provider delivery; cleanup cannot race a late send.
    await tx.$queryRaw`SELECT id FROM "SubjectAccessRequest" WHERE id=${candidate.id} FOR UPDATE`;
    const current = await tx.subjectAccessRequest.findUnique({ where: { id: candidate.id } });
    if (!current || current.expiresAt >= cutoff) return 0;
    const mail = await tx.job.findUnique({ where: { dedupeKey: "mail:subject-access:" + current.id } });
    if (mail) {
      if (env.MAIL_TRANSPORT === "local") await unlink(resolve(env.LOCAL_MAIL_DIR, mail.id + ".json")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await tx.job.update({ where: { id: mail.id }, data: { payloadCipher: encrypt({ erased: true }), status: "cancelled", lastError: "AUTH_EXPIRED", leaseOwner: null, leaseUntil: null } });
    }
    await tx.subjectAccessRequest.delete({ where: { id: current.id } }); return 1;
  });
  return { count };
}
