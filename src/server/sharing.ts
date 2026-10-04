import type { Context } from "./context";
import { randomUUID } from "node:crypto";
import { db, type Transaction } from "./db";
import { decrypt, encrypt, opaqueToken, tokenHash } from "./crypto";
import { fail, requireVersion } from "./http";
import { assertFileDeadlines, canReadFiles, lockFileContext } from "./file-access";
import { audit } from "./audit";
import { enqueueMail } from "./jobs";
import { env } from "./env";
import type { ShareInput, ShareUpdate, ShareRecord, SharePermissions } from "@/contracts/sharing";
import { rowSchema } from "@/contracts/questions";
import { idempotent } from "./idempotency";
import { invalidateShareCache } from "./share-cache";

export const shareInclude = { fields: { include: { question: true } }, formVersion: true, creator: { select: { userId: true } } } as const;
export type Grant = NonNullable<Awaited<ReturnType<typeof findShare>>>;
export const findShare = (tx: Transaction, id: string) => tx.shareGrant.findUnique({ where: { id }, include: shareInclude });
export const grantQuestions = (row: Grant) => row.fields.map(field => field.question).sort((a, b) => a.order - b.order)
  .map(question => ({ id: question.stableKey, label: question.label, type: question.type,
    ...(question.matrixRows ? { rows: rowSchema.array().parse(question.matrixRows) } : {}) }));
export function shareDto(row: Grant, permissions: SharePermissions): ShareRecord {
  return { id: row.id, formId: row.formId, formVersionId: row.formVersionId, formTitle: row.formVersion.title,
    formNumber: row.formVersion.number, email: decrypt<string>(row.emailCipher), questions: grantQuestions(row),
    questionIds: grantQuestions(row).map(q => q.id), expiresAt: row.expiresAt.toISOString(),
    status: row.revokedAt ? "revoked" : row.expiresAt <= new Date() ? "expired" : "active", version: row.version, createdAt: row.createdAt.toISOString(),
    actions: { edit: permissions.canCreate && !row.revokedAt, revoke: !row.revokedAt,
      resend: permissions.canCreate && !row.revokedAt && row.expiresAt > new Date() && (permissions.canSelectFiles || !row.fields.some(f => f.question.type === "파일 업로드")) } };
}
export async function lockShareForm(tx: Transaction, ctx: Context, id: string, active = false) {
  const first = await tx.form.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!first) fail(404, "NOT_FOUND", "캐치폼을 찾을 수 없습니다.");
  const deadlines = await lockFileContext(tx, ctx, first.serviceId, ["share.manage", "submission.read"], !active);
  await tx.$queryRaw`SELECT id FROM "Form" WHERE id=${id} AND "tenantId"=${ctx.tenantId} FOR SHARE`;
  const form = await tx.form.findUniqueOrThrow({ where: { id } });
  if (active && form.status === "archived" && form.sourceType !== "import") fail(409, "FORM_ARCHIVED", "보관된 폼은 외부 공유를 변경할 수 없습니다.");
  assertFileDeadlines(deadlines);
  return { ...form, deadlines };
}
async function sharePermissions(tx: Transaction, ctx: Context, form: Awaited<ReturnType<typeof lockShareForm>>): Promise<SharePermissions> {
  const service = await tx.service.findUniqueOrThrow({ where: { id: form.serviceId } });
  const canSelectFiles = await canReadFiles(tx, ctx, form.serviceId), hasPublished = !!await tx.formVersion.count({ where: { tenantId: ctx.tenantId, formId: form.id, status: "published" } });
  const reason = service.status !== "active" ? "보관된 서비스에서는 새 초대나 공유 변경을 할 수 없습니다. 기존 권한은 회수할 수 있습니다."
    : form.status === "archived" && form.sourceType !== "import" ? "보관된 폼에서는 새 초대나 공유 변경을 할 수 없습니다. 기존 권한은 회수할 수 있습니다."
      : !hasPublished ? "폼을 먼저 게시한 뒤 외부 열람자를 초대해주세요." : null;
  assertFileDeadlines(form.deadlines);
  return { canCreate: !reason, canSelectFiles, reason };
}
async function managerGrant(tx: Transaction, ctx: Context, id: string, write = false, active = false) {
  const first = await tx.shareGrant.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!first) fail(404, "NOT_FOUND", "공유 권한을 찾을 수 없습니다.");
  const form = await lockShareForm(tx, ctx, first.formId, active);
  if (write) await tx.$queryRaw`SELECT id FROM "ShareGrant" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "ShareGrant" WHERE id=${id} FOR SHARE`;
  const row = (await findShare(tx, id))!;
  assertFileDeadlines(form.deadlines);
  return { row, form };
}
function checkedExpiry(value: string) {
  const expiresAt = new Date(value), now = Date.now();
  if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 90 * 86400000)
    fail(422, "INVALID_EXPIRY", "공유 종료일은 현재 이후부터 90일 이내로 설정해주세요.");
  return expiresAt;
}
async function checkedFields(tx: Transaction, ctx: Context, formId: string, formVersionId: string, ids: string[]) {
  const row = await tx.formVersion.findFirst({ where: { id: formVersionId, formId, tenantId: ctx.tenantId, status: "published" }, include: { questions: true, form: true } });
  if (!row) fail(404, "VERSION_NOT_FOUND", "게시된 폼 버전을 찾을 수 없습니다.");
  const selected = row.questions.filter(question => ids.includes(question.stableKey));
  if (selected.length !== ids.length) fail(422, "INVALID_SHARE_FIELDS", "이 게시 버전에 포함된 항목만 공유할 수 있습니다.");
  if (selected.some(question => question.type === "파일 업로드")) await lockFileContext(tx, ctx, row.form.serviceId, ["file.read"]);
  return selected;
}
async function invitationMail(tx: Transaction, row: Grant, code: string) {
  await enqueueMail({ to: decrypt<string>(row.emailCipher), subject: "외부 개인정보 열람 초대",
    text: [row.formVersion.title + " (게시 버전 " + row.formVersion.number + ") 열람에 초대되었습니다.",
      "캐치폼 코드: " + row.formId, "열람자 인증코드: " + code,
      "아래 페이지에서 이 이메일 주소와 초대 정보를 입력한 뒤 이메일 인증을 완료해주세요.",
      new URL("/shared-privacy/verify", env.BETTER_AUTH_URL).href,
      "열람 종료: " + row.expiresAt.toISOString(), "공유 항목이나 기한이 변경되면 다시 인증해야 합니다."].join("\n") },
    "share:" + row.id + ":invite:" + row.version, tx, row.tenantId);
}
async function invalidate(tx: Transaction, row: Grant) {
  const now = new Date();
  await tx.viewerChallenge.updateMany({ where: { grantId: row.id, consumedAt: null }, data: { consumedAt: now } });
  await tx.viewerSession.updateMany({ where: { grantId: row.id, revokedAt: null }, data: { revokedAt: now } });
  await tx.job.updateMany({ where: { dedupeKey: { startsWith: "mail:share:" + row.id + ":" }, status: { in: ["queued", "retry"] } }, data: { status: "cancelled" } });
}
export async function shareOptions(ctx: Context, formId: string) {
  return db.$transaction(async tx => {
    const form = await lockShareForm(tx, ctx, formId);
    const versions = await tx.formVersion.findMany({ where: { tenantId: ctx.tenantId, formId, status: "published" },
      include: { questions: { orderBy: { order: "asc" } } }, orderBy: { number: "desc" } });
    const permissions = await sharePermissions(tx, ctx, form);
    const result = { formCode: formId, permissions, versions: versions.map(row => ({ id: row.id, number: row.number, title: row.title,
      questions: row.questions.map(q => ({ id: q.stableKey, label: q.label, type: q.type, selectable: permissions.canCreate && (q.type !== "파일 업로드" || permissions.canSelectFiles), ...(q.matrixRows ? { rows: rowSchema.array().parse(q.matrixRows) } : {}) })) })) };
    assertFileDeadlines(form.deadlines);
    return result;
  });
}
export async function listShares(ctx: Context, formId: string, query: { page: number; pageSize: number; status?: string; search?: string }, requestId: string = randomUUID()) {
  return db.$transaction(async tx => {
    const form = await lockShareForm(tx, ctx, formId);
    const now = new Date(), where = { tenantId: ctx.tenantId, formId,
      ...(query.search?.trim() ? { emailHash: tokenHash(query.search.trim().toLowerCase()) } : {}),
      ...(query.status === "revoked" ? { revokedAt: { not: null } } : query.status === "expired" ? { revokedAt: null, expiresAt: { lte: now } }
        : query.status === "active" ? { revokedAt: null, expiresAt: { gt: now } } : {}) };
    const total = await tx.shareGrant.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const items = await tx.shareGrant.findMany({ where, include: shareInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    const permissions = await sharePermissions(tx, ctx, form), result = { items: items.map(row => shareDto(row, permissions)), total, page, pageSize: query.pageSize, permissions };
    await audit(tx, ctx, requestId, "share.list_viewed", "shareGrant", undefined, [], form.serviceId);
    assertFileDeadlines(form.deadlines);
    return result;
  });
}
export async function getShare(ctx: Context, id: string, requestId: string = randomUUID()) {
  return db.$transaction(async tx => { const { row, form } = await managerGrant(tx, ctx, id), permissions = await sharePermissions(tx, ctx, form);
    const result = shareDto(row, permissions);
    await audit(tx, ctx, requestId, "share.viewed", "shareGrant", id, [], form.serviceId);
    assertFileDeadlines(form.deadlines); return result; });
}
export async function createShareRequest(ctx: Context, input: ShareInput, key: string | null, requestId: string) {
  return idempotent("share:create:" + ctx.tenantId + ":" + ctx.member.id, key, input, async tx => {
    const body = await createShare(ctx, input, requestId, tx);
    return { status: 201, body, resource: { tenantId: ctx.tenantId, resourceType: "shareGrant", resourceId: body.id } };
  }, tx => lockShareForm(tx, ctx, input.formId, true), async (tx, cached) => {
    const { row, form } = await managerGrant(tx, ctx, cached.id, false, true);
    if (row.formId !== input.formId || row.formVersionId !== input.formVersionId || row.createdBy !== ctx.member.id || row.revokedAt || row.expiresAt <= new Date() || row.version !== cached.version)
      fail(410, "SHARE_REQUEST_EXPIRED", "공유 권한이 변경되었거나 종료되었습니다. 최신 공유 목록을 확인해주세요.");
    if (row.fields.some(f => f.question.type === "파일 업로드")) await lockFileContext(tx, ctx, form.serviceId, ["file.read"]);
    const result = shareDto(row, await sharePermissions(tx, ctx, form)); assertFileDeadlines(form.deadlines);
    await audit(tx, ctx, requestId, "share.viewed", "shareGrant", row.id, [], form.serviceId);
    assertFileDeadlines(form.deadlines);
    if (row.expiresAt <= new Date()) fail(410, "SHARE_REQUEST_EXPIRED", "공유 기한이 종료되었습니다. 최신 공유 목록을 확인해주세요.");
    return result;
  });
}
export async function createShare(ctx: Context, input: ShareInput, requestId: string, tx: Transaction) {
  const form = await lockShareForm(tx, ctx, input.formId, true), expiresAt = checkedExpiry(input.expiresAt);
  const fields = await checkedFields(tx, ctx, form.id, input.formVersionId, input.questionIds), code = opaqueToken();
  const row = await tx.shareGrant.create({ data: { tenantId: ctx.tenantId, serviceId: form.serviceId, formId: form.id,
    formVersionId: input.formVersionId, createdBy: ctx.member.id, emailCipher: encrypt(input.email), emailHash: tokenHash(input.email),
    codeHash: tokenHash(code), expiresAt }, include: shareInclude });
  await tx.shareField.createMany({ data: fields.map(q => ({ tenantId: ctx.tenantId, grantId: row.id, formVersionId: input.formVersionId, questionId: q.id })) });
  const saved = (await findShare(tx, row.id))!;
  await invitationMail(tx, saved, code);
  await audit(tx, ctx, requestId, "share.created", "shareGrant", row.id, ["email", "questionIds", "expiresAt"], form.serviceId);
  const result = shareDto(saved, await sharePermissions(tx, ctx, form));
  assertFileDeadlines(form.deadlines);
  if (expiresAt <= new Date()) fail(422, "INVALID_EXPIRY", "공유 종료일이 지났습니다. 다시 설정해주세요.");
  return result;
}
export async function changeShare(ctx: Context, id: string, input: ShareUpdate | { version: number }, action: "update" | "resend" | "revoke", requestId: string) {
  return db.$transaction(async tx => {
    const { row, form } = await managerGrant(tx, ctx, id, true, action !== "revoke");
    requireVersion(input, row);
    if (row.revokedAt) fail(409, "SHARE_REVOKED", "회수한 공유 권한은 다시 사용할 수 없습니다. 새로 초대해주세요.");
    if (action === "resend" && row.expiresAt <= new Date()) fail(409, "SHARE_EXPIRED", "공유 기한을 변경한 뒤 초대해주세요.");
    if (action === "resend" && row.fields.some(f => f.question.type === "파일 업로드")) await lockFileContext(tx, ctx, row.serviceId, ["file.read"]);
    const next = action === "update" ? input as ShareUpdate : null;
    const expiresAt = next ? checkedExpiry(next.expiresAt) : row.expiresAt;
    const fields = next ? await checkedFields(tx, ctx, row.formId, row.formVersionId, next.questionIds) : null;
    const code = opaqueToken();
    await invalidate(tx, row);
    await invalidateShareCache(tx, row.tenantId, row.createdBy, row.id);
    await tx.shareGrant.update({ where: { id }, data: { version: { increment: 1 },
      ...(action === "revoke" ? { revokedAt: new Date() } : { codeHash: tokenHash(code), expiresAt }),
      ...(next ? { emailCipher: encrypt(next.email), emailHash: tokenHash(next.email) } : {}) } });
    if (fields) {
      await tx.shareField.deleteMany({ where: { grantId: id } });
      await tx.shareField.createMany({ data: fields.map(q => ({ tenantId: ctx.tenantId, grantId: id, formVersionId: row.formVersionId, questionId: q.id })) });
    }
    const updated = (await findShare(tx, id))!;
    if (action !== "revoke") await invitationMail(tx, updated, code);
    await audit(tx, ctx, requestId, "share." + ({ update: "updated", resend: "resent", revoke: "revoked" }[action]), "shareGrant", id,
      next ? ["email", "questionIds", "expiresAt"] : ["status"], row.serviceId);
    const result = shareDto(updated, await sharePermissions(tx, ctx, form));
    assertFileDeadlines(form.deadlines);
    if (action !== "revoke" && expiresAt <= new Date()) fail(409, "SHARE_EXPIRED", "공유 기한이 종료되었습니다. 기한을 변경한 뒤 다시 초대해주세요.");
    return result;
  });
}
export async function shareEvents(ctx: Context, id: string, query: { page: number; pageSize: number }) {
  return db.$transaction(async tx => {
    const { form } = await managerGrant(tx, ctx, id);
    const where = { tenantId: ctx.tenantId, resource: "shareGrant", resourceId: id };
    const total = await tx.auditEvent.count({ where }), page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const result = { items: await tx.auditEvent.findMany({ where, select: { id: true, action: true, createdAt: true, detail: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * query.pageSize, take: query.pageSize }), total, page, pageSize: query.pageSize };
    assertFileDeadlines(form.deadlines);
    return result;
  });
}
