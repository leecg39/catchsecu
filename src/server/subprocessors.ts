import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Subprocessor } from "@/generated/prisma/client";
import { subprocessorInput, subprocessorNoticeInput, subprocessorPatch } from "@/contracts/subprocessors";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail, listQuery } from "./http";
import { audit } from "./audit";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { contactEmailHash } from "./suppression";
import { enqueueMail } from "./jobs";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";
import { idempotent } from "./idempotency";
import type { SubprocessorNoticeRecord } from "@/contracts/subprocessors";

const noticeJobStatus: Record<string, SubprocessorNoticeRecord["status"]> = {
  queued: "queued", leased: "processing", retry: "retry", done: "processed", dead: "failed", cancelled: "suppressed",
};

function emailOf(row: Subprocessor) { return decrypt<string>(row.emailCipher); }
function dto(row: Subprocessor) {
  return { id: row.id, serviceId: row.serviceId, name: row.name, email: emailOf(row), changeSummary: row.changeSummary,
    status: row.status, version: row.version, createdAt: row.createdAt };
}
async function lockService(tx: Transaction, ctx: Context, serviceId: string) {
  const actor = await lockServiceActor(tx, ctx, "service.manage");
  const service = await tx.service.findFirst({ where: { AND: [actor.scope, { id: serviceId }] } });
  if (!service) {
    if (!await tx.service.count({ where: { id: serviceId, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 재위탁 수신자와 안내를 사용할 수 없습니다.");
  return actor.deadlines;
}
export async function listSubprocessors(ctx: Context, serviceId: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    const where = { tenantId: ctx.tenantId, serviceId, ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}) };
    const total = await tx.subprocessor.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.subprocessor.findMany({ where, orderBy: [{ createdAt: query.direction }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    assertFileDeadlines(deadlines);
    return { items: rows.map(dto), total, page, pageSize: query.pageSize };
  });
}
export async function getSubprocessor(ctx: Context, serviceId: string, id: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    const row = await tx.subprocessor.findFirst({ where: { id, tenantId: ctx.tenantId, serviceId } });
    if (!row) fail(404, "NOT_FOUND", "재위탁 수신자를 찾을 수 없습니다.");
    assertFileDeadlines(deadlines);
    return dto(row);
  });
}
export async function createSubprocessor(tx: Transaction, ctx: Context, serviceId: string, input: z.infer<typeof subprocessorInput>, requestId: string) {
  const deadlines = await lockService(tx, ctx, serviceId);
  const email = input.email.toLowerCase();
  const emailHash = contactEmailHash(email);
  const existing = await tx.subprocessor.findFirst({ where: { tenantId: ctx.tenantId, serviceId, emailHash } });
  if (existing?.status === "archived") fail(409, "SUBPROCESSOR_ARCHIVED", "보관된 재위탁 수신자입니다. 목록에서 복원해주세요.");
  if (existing) fail(409, "ALREADY_EXISTS", "이 서비스에 같은 수신자가 이미 있습니다.");
  const row = await tx.subprocessor.create({ data: { tenantId: ctx.tenantId, serviceId, name: input.name, emailCipher: encrypt(email), emailHash, changeSummary: input.changeSummary } });
  await audit(tx, ctx, requestId, "subprocessor.created", "subprocessor", row.id, ["name", "email", "changeSummary"], serviceId);
  assertFileDeadlines(deadlines);
  return dto(row);
}
export async function updateSubprocessor(ctx: Context, serviceId: string, id: string, input: z.infer<typeof subprocessorPatch>, requestId: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    await tx.$queryRaw`SELECT id FROM "Subprocessor" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
    const current = await tx.subprocessor.findFirst({ where: { id, tenantId: ctx.tenantId, serviceId } });
    if (!current) fail(404, "NOT_FOUND", "재위탁 수신자를 찾을 수 없습니다.");
    if (current.version !== input.version) fail(409, "VERSION_CONFLICT", "다른 곳에서 수정되었습니다. 최신 내용을 불러와주세요.");
    const email = input.email.toLowerCase();
    const emailHash = contactEmailHash(email);
    const duplicate = await tx.subprocessor.findFirst({ where: { tenantId: ctx.tenantId, serviceId, emailHash, NOT: { id } } });
    if (duplicate) fail(409, "ALREADY_EXISTS", "이 서비스에 같은 수신자가 이미 있습니다.");
    const row = await tx.subprocessor.update({ where: { id }, data: { name: input.name, emailCipher: encrypt(email), emailHash, changeSummary: input.changeSummary, status: input.status, version: { increment: 1 } } });
    await audit(tx, ctx, requestId, "subprocessor.updated", "subprocessor", id, ["name", "email", "changeSummary", "status"], serviceId);
    assertFileDeadlines(deadlines);
    return dto(row);
  });
}
export async function listSubprocessorNotices(ctx: Context, serviceId: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    const where = { tenantId: ctx.tenantId, serviceId, ...(query.search ? { subject: { contains: query.search, mode: "insensitive" as const } } : {}) };
    const total = await tx.subprocessorNotice.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.subprocessorNotice.findMany({ where, orderBy: [{ createdAt: query.direction }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    const jobs = await tx.job.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.flatMap(row => row.jobId ? [row.jobId] : []) }, type: "mail" },
      select: { id: true, dedupeKey: true, status: true, payloadCipher: true, payloadErasedAt: true, completedAt: true } });
    const byId = new Map(jobs.map(job => [job.id, job]));
    const result = { items: rows.map(row => {
      const candidate = row.jobId ? byId.get(row.jobId) : undefined;
      const job = candidate?.dedupeKey === "mail:subprocessor-notice:" + row.id ? candidate : undefined;
      // The job holds the address used for this send. A mutable address book cannot reconstruct history.
      const payload = job && !job.payloadErasedAt ? decrypt<{ to?: unknown }>(job.payloadCipher) : undefined;
      return { id: row.id, subprocessorId: row.subprocessorId, name: null, email: typeof payload?.to === "string" ? payload.to : null,
        subject: row.subject, status: job ? noticeJobStatus[job.status] ?? "unknown" : "unknown", createdAt: row.createdAt,
        completedAt: job?.completedAt ?? null };
    }), total, page, pageSize: query.pageSize };
    assertFileDeadlines(deadlines);
    return result;
  });
}
export async function sendSubprocessorNotice(tx: Transaction, ctx: Context, serviceId: string, input: z.infer<typeof subprocessorNoticeInput>, requestId: string) {
  const deadlines = await lockService(tx, ctx, serviceId);
  await tx.$queryRaw`SELECT id FROM "Subprocessor" WHERE id=${input.subprocessorId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  const row = await tx.subprocessor.findFirst({ where: { id: input.subprocessorId, tenantId: ctx.tenantId, serviceId } });
  if (!row) fail(404, "NOT_FOUND", "재위탁 수신자를 찾을 수 없습니다.");
  if (row.status !== "active") fail(409, "SUBPROCESSOR_ARCHIVED", "보관된 수신자에게는 안내를 보낼 수 없습니다.");
  if (row.version !== input.recipientVersion) fail(409, "VERSION_CONFLICT", "수신자 정보가 변경되었습니다. 최신 주소를 확인한 후 다시 발송해주세요.");
  const contentHash = tokenHash(row.id + "\n" + input.subject + "\n" + input.body);
  if (await tx.subprocessorNotice.findFirst({ where: { tenantId: ctx.tenantId, subprocessorId: row.id, contentHash } }))
    fail(409, "DUPLICATE_NOTICE", "같은 재위탁 안내는 이미 기록되어 있습니다.");
  const id = randomUUID();
  const email = emailOf(row);
  const job = await enqueueMail({ to: email, subject: input.subject, text: input.body }, "subprocessor-notice:" + id, tx, ctx.tenantId);
  const notice = await tx.subprocessorNotice.create({ data: { id, tenantId: ctx.tenantId, serviceId, subprocessorId: row.id, subject: input.subject,
    bodyCipher: encrypt(input.body), contentHash, jobId: job.id, actorId: ctx.user.id } });
  await audit(tx, ctx, requestId, "subprocessor.notice_queued", "subprocessorNotice", id, ["subject"], serviceId);
  assertFileDeadlines(deadlines);
  return { id: notice.id, subprocessorId: row.id, name: row.name, email, subject: notice.subject, status: notice.status, createdAt: notice.createdAt };
}

// The scope stays compatible with existing request keys; replay must reauthorize before revealing cached PII.
export async function createSubprocessorRequest(ctx: Context, serviceId: string, input: z.infer<typeof subprocessorInput>, key: string | null, requestId: string) {
  let deadlines: Awaited<ReturnType<typeof lockService>>;
  return idempotent("subprocessor:create:" + ctx.tenantId + ":" + serviceId, key, input, async tx => {
    deadlines = await lockService(tx, ctx, serviceId);
    const row = await createSubprocessor(tx, ctx, serviceId, input, requestId);
    return { status: 201, body: row, resource: { tenantId: ctx.tenantId, resourceType: "subprocessor", resourceId: row.id } };
  }, async tx => { deadlines = await lockService(tx, ctx, serviceId); }, async (tx, cached) => {
    await tx.$queryRaw`SELECT id FROM "Subprocessor" WHERE id=${cached.id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const row = await tx.subprocessor.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId, serviceId, status: "active" } });
    if (!row) fail(410, "SUBPROCESSOR_UNAVAILABLE", "수신자가 삭제되거나 보관되었습니다. 최신 목록을 확인해주세요.");
    return dto(row);
  }, async () => { assertFileDeadlines(deadlines); });
}
export async function sendSubprocessorNoticeRequest(ctx: Context, serviceId: string, input: z.infer<typeof subprocessorNoticeInput>, key: string | null, requestId: string) {
  let deadlines: Awaited<ReturnType<typeof lockService>>;
  return idempotent("subprocessor-notice:" + ctx.tenantId + ":" + serviceId, key, input, async tx => {
    deadlines = await lockService(tx, ctx, serviceId);
    const notice = await sendSubprocessorNotice(tx, ctx, serviceId, input, requestId);
    return { status: 201, body: notice, resource: { tenantId: ctx.tenantId, resourceType: "subprocessor-notice", resourceId: notice.id } };
  }, async tx => { deadlines = await lockService(tx, ctx, serviceId); }, async (tx, cached) => {
    const row = await tx.subprocessorNotice.findFirst({ where: { id: cached.id, tenantId: ctx.tenantId, serviceId } });
    if (!row?.jobId) fail(410, "NOTICE_UNAVAILABLE", "안내 요청의 보관 기간이 끝났습니다. 발송 이력을 확인해주세요.");
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${row.jobId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
    const job = await tx.job.findFirst({ where: { id: row.jobId, tenantId: ctx.tenantId, type: "mail", dedupeKey: "mail:subprocessor-notice:" + row.id, payloadErasedAt: null } });
    if (!job) fail(410, "NOTICE_UNAVAILABLE", "안내 요청의 보관 기간이 끝났습니다. 발송 이력을 확인해주세요.");
    // Receipt of the original request, not a new send to a possibly edited recipient.
    return cached;
  }, async () => { assertFileDeadlines(deadlines); });
}
