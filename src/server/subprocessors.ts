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
import { lockFormService } from "./form-access";

function emailOf(row: Subprocessor) { return decrypt<string>(row.emailCipher); }
function dto(row: Subprocessor) {
  return { id: row.id, serviceId: row.serviceId, name: row.name, email: emailOf(row), changeSummary: row.changeSummary,
    status: row.status, version: row.version, createdAt: row.createdAt };
}
async function lockService(tx: Transaction, ctx: Context, serviceId: string) {
  return lockFormService(tx, ctx, serviceId, "service.manage");
}
export async function listSubprocessors(ctx: Context, serviceId: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    await lockService(tx, ctx, serviceId);
    const where = { tenantId: ctx.tenantId, serviceId, ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}) };
    const total = await tx.subprocessor.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.subprocessor.findMany({ where, orderBy: [{ createdAt: query.direction }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    return { items: rows.map(dto), total, page, pageSize: query.pageSize };
  });
}
export async function createSubprocessor(tx: Transaction, ctx: Context, serviceId: string, input: z.infer<typeof subprocessorInput>, requestId: string) {
  await lockService(tx, ctx, serviceId);
  const email = input.email.toLowerCase();
  const emailHash = contactEmailHash(email);
  const existing = await tx.subprocessor.findFirst({ where: { tenantId: ctx.tenantId, serviceId, emailHash } });
  if (existing?.status === "archived") fail(409, "SUBPROCESSOR_ARCHIVED", "보관된 재위탁 수신자입니다. 목록에서 복원해주세요.");
  if (existing) fail(409, "ALREADY_EXISTS", "이 서비스에 같은 수신자가 이미 있습니다.");
  const row = await tx.subprocessor.create({ data: { tenantId: ctx.tenantId, serviceId, name: input.name, emailCipher: encrypt(email), emailHash, changeSummary: input.changeSummary } });
  await audit(tx, ctx, requestId, "subprocessor.created", "subprocessor", row.id, ["name", "email", "changeSummary"], serviceId);
  return dto(row);
}
export async function updateSubprocessor(ctx: Context, serviceId: string, id: string, input: z.infer<typeof subprocessorPatch>, requestId: string) {
  return db.$transaction(async tx => {
    await lockService(tx, ctx, serviceId);
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
    return dto(row);
  });
}
export async function listSubprocessorNotices(ctx: Context, serviceId: string, query: z.infer<typeof listQuery>) {
  return db.$transaction(async tx => {
    await lockService(tx, ctx, serviceId);
    const where = { tenantId: ctx.tenantId, serviceId, ...(query.search ? { subject: { contains: query.search, mode: "insensitive" as const } } : {}) };
    const total = await tx.subprocessorNotice.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.subprocessorNotice.findMany({ where, include: { subprocessor: true }, orderBy: [{ createdAt: query.direction }, { id: "asc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    return { items: rows.map(row => ({ id: row.id, subprocessorId: row.subprocessorId, name: row.subprocessor.name, email: emailOf(row.subprocessor),
      subject: row.subject, status: row.status, createdAt: row.createdAt })), total, page, pageSize: query.pageSize };
  });
}
export async function sendSubprocessorNotice(tx: Transaction, ctx: Context, serviceId: string, input: z.infer<typeof subprocessorNoticeInput>, requestId: string) {
  await lockService(tx, ctx, serviceId);
  await tx.$queryRaw`SELECT id FROM "Subprocessor" WHERE id=${input.subprocessorId} AND "tenantId"=${ctx.tenantId} FOR UPDATE`;
  const row = await tx.subprocessor.findFirst({ where: { id: input.subprocessorId, tenantId: ctx.tenantId, serviceId } });
  if (!row) fail(404, "NOT_FOUND", "재위탁 수신자를 찾을 수 없습니다.");
  if (row.status !== "active") fail(409, "SUBPROCESSOR_ARCHIVED", "보관된 수신자에게는 안내를 보낼 수 없습니다.");
  const contentHash = tokenHash(row.id + "\n" + input.subject + "\n" + input.body);
  if (await tx.subprocessorNotice.findFirst({ where: { tenantId: ctx.tenantId, subprocessorId: row.id, contentHash } }))
    fail(409, "DUPLICATE_NOTICE", "같은 재위탁 안내는 이미 기록되어 있습니다.");
  const id = randomUUID();
  const email = emailOf(row);
  const job = await enqueueMail({ to: email, subject: input.subject, text: input.body }, "subprocessor-notice:" + id, tx, ctx.tenantId);
  const notice = await tx.subprocessorNotice.create({ data: { id, tenantId: ctx.tenantId, serviceId, subprocessorId: row.id, subject: input.subject,
    bodyCipher: encrypt(input.body), contentHash, jobId: job.id, actorId: ctx.user.id } });
  await audit(tx, ctx, requestId, "subprocessor.notice_queued", "subprocessorNotice", id, ["subject"], serviceId);
  return { id: notice.id, subprocessorId: row.id, name: row.name, email, subject: notice.subject, status: notice.status, createdAt: notice.createdAt };
}
