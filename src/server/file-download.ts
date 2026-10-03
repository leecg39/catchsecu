import type { Context } from "./context";
import { db, type Transaction } from "./db";
import { fileInfo, lockFileContext, lockFileSubmission } from "./file-access";
import { fail } from "./http";
import { privateFiles } from "./file-storage";
import { validateFileBytes } from "./file-validation";
import { decrypt } from "./crypto";
import { audit } from "./audit";
import type { FileObject } from "@/generated/prisma/client";
import { lockCampaignForFile } from "./campaign-file-access";
import { lockSenderForFile } from "./sender-access";

type Binding = { campaignId?: string; submissionId?: string; questionId?: string; senderId?: string };
export async function readFile<T>(ctx: Context, id: string, binding: Binding, requestId: string,
  operation: (tx: Transaction, file: FileObject & { question: { stableKey: string } | null }) => Promise<T>) {
  return db.$transaction(async tx => {
    const initial = await tx.fileObject.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { question: { select: { stableKey: true } } } });
    if (!initial || (initial.submissionId ? binding.submissionId !== initial.submissionId || binding.questionId !== initial.question?.stableKey : binding.submissionId || binding.questionId) || (initial.senderId ? binding.senderId !== initial.senderId : binding.senderId) || (initial.campaignId ? binding.campaignId !== initial.campaignId : binding.campaignId))
      fail(404, "NOT_FOUND", "응답과 질문에 연결된 파일을 찾을 수 없습니다.");
    if (initial.ownerKind === "public" && !initial.submissionId) fail(409, "FILE_NOT_AVAILABLE", "응답 제출이 완료된 파일만 열람할 수 있습니다.");
    await lockFileContext(tx, ctx, initial.serviceId, initial.campaignId ? ["message.read"] : initial.senderId ? ["sender.manage"] : initial.submissionId ? ["submission.read", "file.read"] : [initial.ownerId === ctx.user.id ? "file.write" : "file.read"]);
    if (initial.campaignId) await lockCampaignForFile(tx, initial);
    if (initial.senderId) await lockSenderForFile(tx, initial);
    if (initial.submissionId) await lockFileSubmission(tx, ctx.tenantId, initial.submissionId);
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id=${id} FOR SHARE`;
    const file = await tx.fileObject.findUniqueOrThrow({ where: { id }, include: { question: { select: { stableKey: true } } } });
    if (((file.submissionId || file.senderId || file.campaignId) && file.status !== "attached") || (!file.submissionId && !file.senderId && !file.campaignId && file.status !== "ready") || file.scanStatus !== "clean")
      fail(409, "FILE_NOT_AVAILABLE", "다운로드할 수 없는 파일입니다.");
    if (file.expiresAt && file.expiresAt <= new Date()) fail(410, "FILE_EXPIRED", "파일 보유 기한이 만료되었습니다.");
    const result = await operation(tx, file);
    await audit(tx, ctx, requestId, "file.viewed", "file", id, [], file.serviceId);
    return result;
  }, { timeout: 15000 });
}
export async function fileMetadata(ctx: Context, id: string, binding: Binding, requestId: string) {
  return readFile(ctx, id, binding, requestId, async (_tx, file) => fileInfo(file));
}
export async function downloadFile(ctx: Context, id: string, binding: Binding, requestId: string) {
  return readFile(ctx, id, binding, requestId, async (tx, file) => {
    const bytes = await privateFiles.read(file.storageKey), name = decrypt<string>(file.nameCipher!);
    validateFileBytes(bytes, { ...file, name });
    await audit(tx, ctx, requestId, "file.downloaded", "file", id, [], file.serviceId);
    const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, value => "%" + value.charCodeAt(0).toString(16).toUpperCase());
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": file.mime, "Content-Length": String(bytes.length),
      "Content-Disposition": "attachment; filename=\"attachment\"; filename*=UTF-8''" + encodedName,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    } });
  });
}
export async function listSubmissionFiles(ctx: Context, submissionId: string, page: number, pageSize: number, requestId: string) {
  return db.$transaction(async tx => {
    const initial = await tx.submission.findFirst({ where: { id: submissionId, tenantId: ctx.tenantId }, include: { formVersion: { include: { form: true } } } });
    if (!initial) fail(404, "NOT_FOUND", "응답을 찾을 수 없습니다.");
    await lockFileContext(tx, ctx, initial.formVersion.form.serviceId, ["submission.read", "file.read"]);
    await lockFileSubmission(tx, ctx.tenantId, submissionId);
    const where = { tenantId: ctx.tenantId, submissionId, status: "attached", scanStatus: "clean" };
    const items = await tx.fileObject.findMany({ where, include: { question: { select: { stableKey: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    const total = await tx.fileObject.count({ where });
    await audit(tx, ctx, requestId, "file.list_viewed", "submission", submissionId, [], initial.formVersion.form.serviceId);
    return { items: items.map(fileInfo), total, page, pageSize };
  });
}
