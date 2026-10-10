import { createHash } from "node:crypto";
import type { z } from "zod";
import { participationEmailSchema, participationTargetImportSchema } from "@/contracts/form-participation-access";
import type { Context } from "./context";
import { decrypt, encrypt, tokenHash } from "./crypto";
import { lockCurrentForm } from "./forms";
import { formTransaction } from "./form-access";
import { fail } from "./http";

function batchDto(row: { id: string; nameCipher: string; acceptedCount: number; rejectedCount: number; version: number; createdAt: Date }) {
  return { id: row.id, name: decrypt<string>(row.nameCipher), acceptedCount: row.acceptedCount,
    rejectedCount: row.rejectedCount, version: row.version, createdAt: row.createdAt.toISOString() };
}

export async function listParticipationTargetBatches(ctx: Context, formId: string) {
  return formTransaction(ctx, "form.read", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, formId, "form.read");
    const batches = await tx.formAccessTargetBatch.findMany({ where: { tenantId: ctx.tenantId, formId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const targetCount = await tx.formAccessTarget.count({ where: { tenantId: ctx.tenantId, formId } });
    return { formId, formVersion: form.version, targetCount, batches: batches.map(batchDto) };
  });
}

export async function importParticipationTargets(ctx: Context, formId: string,
  raw: z.infer<typeof participationTargetImportSchema>, requestId: string) {
  const input = participationTargetImportSchema.parse(raw);
  return formTransaction(ctx, "form.write", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, formId, "form.write", true);
    if (form.version !== input.version) fail(409, "VERSION_CONFLICT", "캐치폼 설정이 변경되었습니다. 최신 내용을 불러온 뒤 명단을 다시 등록해주세요.");
    const seen = new Set<string>(), candidates: { email: string; hash: string }[] = [];
    let rejectedCount = 0;
    for (const rawEmail of input.emails) {
      const parsed = participationEmailSchema.safeParse(rawEmail);
      if (!parsed.success) { rejectedCount++; continue; }
      const hash = tokenHash("form-participant-email:" + parsed.data);
      if (seen.has(hash)) { rejectedCount++; continue; }
      seen.add(hash); candidates.push({ email: parsed.data, hash });
    }
    const existing = candidates.length ? new Set((await tx.formAccessTarget.findMany({
      where: { tenantId: ctx.tenantId, formId, emailHash: { in: candidates.map(value => value.hash) } }, select: { emailHash: true },
    })).map(value => value.emailHash)) : new Set<string>();
    const accepted = candidates.filter(value => !existing.has(value.hash));
    rejectedCount += candidates.length - accepted.length;
    if (!accepted.length) fail(422, "PARTICIPATION_TARGET_EMPTY", "새로 등록할 수 있는 이메일 대상자가 없습니다. 파일의 형식과 중복 항목을 확인해주세요.");
    const sourceHash = createHash("sha256").update(input.emails.join("\n"), "utf8").digest("hex");
    const batch = await tx.formAccessTargetBatch.create({ data: { tenantId: ctx.tenantId, formId,
      nameCipher: encrypt(input.name), sourceHash, acceptedCount: accepted.length, rejectedCount, createdBy: ctx.member.id } });
    await tx.formAccessTarget.createMany({ data: accepted.map(value => ({ tenantId: ctx.tenantId, formId,
      batchId: batch.id, emailHash: value.hash, emailCipher: encrypt(value.email) })) });
    const changed = await tx.form.updateMany({ where: { id: formId, tenantId: ctx.tenantId, version: input.version }, data: { version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "캐치폼 설정이 변경되었습니다. 최신 내용을 불러온 뒤 명단을 다시 등록해주세요.");
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, requestId,
      action: "form.participation_targets_imported", resource: "form", resourceId: formId, serviceId: form.serviceId,
      detail: { changedFields: ["participationTargets"], batchId: batch.id, acceptedCount: accepted.length, rejectedCount } } });
    return { batch: batchDto(batch), targetCount: await tx.formAccessTarget.count({ where: { tenantId: ctx.tenantId, formId } }),
      formVersion: input.version + 1 };
  }, { timeout: 15000 });
}

export async function deleteParticipationTargetBatch(ctx: Context, formId: string, batchId: string,
  formVersion: number, batchVersion: number, requestId: string) {
  return formTransaction(ctx, "form.write", async tx => {
    const { form } = await lockCurrentForm(tx, ctx, formId, "form.write", true);
    if (form.version !== formVersion) fail(409, "VERSION_CONFLICT", "캐치폼 설정이 변경되었습니다. 최신 내용을 불러온 뒤 명단 삭제를 다시 시도해주세요.");
    await tx.$queryRaw`SELECT id FROM "FormAccessTargetBatch" WHERE id=${batchId} AND "tenantId"=${ctx.tenantId} AND "formId"=${formId} FOR UPDATE`;
    const batch = await tx.formAccessTargetBatch.findFirst({ where: { id: batchId, tenantId: ctx.tenantId, formId } });
    if (!batch) fail(404, "PARTICIPATION_TARGET_BATCH_NOT_FOUND", "대상자 명단 파일을 찾을 수 없습니다.");
    if (batch.version !== batchVersion) fail(409, "VERSION_CONFLICT", "대상자 명단이 변경되었습니다. 목록을 다시 불러와주세요.");
    await tx.formAccessTarget.deleteMany({ where: { tenantId: ctx.tenantId, formId, batchId } });
    await tx.formAccessTargetBatch.delete({ where: { id: batchId } });
    const changed = await tx.form.updateMany({ where: { id: formId, tenantId: ctx.tenantId, version: formVersion }, data: { version: { increment: 1 } } });
    if (!changed.count) fail(409, "VERSION_CONFLICT", "캐치폼 설정이 변경되었습니다. 최신 내용을 불러온 뒤 명단 삭제를 다시 시도해주세요.");
    await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, actorId: ctx.user.id, requestId,
      action: "form.participation_targets_deleted", resource: "form", resourceId: formId, serviceId: form.serviceId,
      detail: { changedFields: ["participationTargets"], batchId, removedCount: batch.acceptedCount } } });
    return { targetCount: await tx.formAccessTarget.count({ where: { tenantId: ctx.tenantId, formId } }), formVersion: formVersion + 1 };
  }, { timeout: 15000 });
}
